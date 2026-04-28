# Trust-Graded Swap — Reputation-Graded Settlement Convention

| Field | Value |
|---|---|
| **Status** | Draft (v0.1) |
| **Author** | Emil Marcel Agustin (`@estmcmxci`) |
| **Created** | 2026-04-28 |
| **Discussion** | [estmcmxci/trust-swap](https://github.com/estmcmxci/trust-swap) |
| **Pitched as** | Future ENSIP, if adoption extends beyond TrustSwap |
| **Extends** | [`@synthesis/resolver` trust-policy spec](https://github.com/estmcmxci/synthesis/blob/main/spec/trust-policy.md) |

## Abstract

This document specifies the **graded-router** pattern: a programmable trust layer that sits between any two parties and the AMM pools they use. Every swap routes through a router contract that verifies an off-chain trust attestation and applies **tier-graded execution terms** before forwarding to the underlying DEX router.

Two complementary primitives compose:

1. A **`RiskPolicy`** schema each identity may publish per ENS, declaring what counterparties they will accept (minimum tier, max accepted size, accepted tokens, optional manifest-signature requirement).
2. A **graded-router** Solidity convention that admits four trust tiers with bucketed limits and fees, reverts the floor (`none`), and enforces a stricter-wins join across both sides of a settlement.

The novel claim is **bidirectional preference signaling** — counterparty preferences are a first-class signal to the settlement layer, not an out-of-band concern.

## Motivation

Reputation systems generally produce a single output: *admit* or *reject*. The graded-router pattern observes that real-world counterparty risk is rarely binary. A trader may be willing to accept a small amount from an unfamiliar counterparty, more from a discoverable one, an unbounded amount from a fully-vetted one — and a fee schedule that compensates the operator for the risk-grading work performed.

Two-sided AMM settlement has additional structure that off-the-shelf reputation gates do not capture:

- The recipient of a swap is exposed to the swapper's reputation (and vice-versa for the swapper accepting a token leg).
- Both sides may want to advertise the limits under which they will accept a counterparty — and have those limits enforced *before* the swap broadcasts, not after.
- The minimum admission floor (the router's "no `none`-tier admitted" rule) and the per-counterparty preferences are different concerns operating at different time scales: the floor is hardcoded by the router operator; preferences are advertised by individual identities and updateable.

Existing patterns conflate or omit these distinctions. The graded-router pattern separates them: the contract enforces the floor + tier-bucket terms; the off-chain oracle enforces RiskPolicy match before signing. RiskPolicy is opt-in. Most identities will leave it absent and rely on the floor alone.

## Definitions

**Trust tier**: One of `none`, `registered`, `discoverable`, `verified`, `full`. Inherited from the [trust-policy spec](https://github.com/estmcmxci/synthesis/blob/main/spec/trust-policy.md). `none` is the only tier that fails admission outright in this convention; the four other tiers are admitted with graded execution terms.

**Floor**: The router's hardcoded refusal to admit a swap where either side resolves to tier `none`.

**Stricter-wins join**: When both swapper and recipient have non-`none` tiers, the router uses `min(swapperTier, recipientTier)` to look up `maxTradeSize` and `feeBps`. The lower-trust side determines terms for both sides.

**Attestation**: A signed message produced by the off-chain oracle stating that, at attestation issuance time, both sides resolved successfully and satisfied each other's published RiskPolicy (if any). Format below.

**RiskPolicy**: A per-identity, opt-in preference object declaring what counterparties the identity will transact with. Schema below. Published per-ENS.

**Oracle**: An off-chain HTTP service that re-resolves both sides via the trust-resolution layer (TRL), fetches both sides' RiskPolicies, and signs an attestation if and only if both sides are admissible and match each other's policy.

## Specification

### 1. RiskPolicy schema

A RiskPolicy is a single object with the following shape, expressed as TypeScript for clarity:

```typescript
interface RiskPolicy {
  /** Minimum tier the publisher will transact with. Defaults to "registered" if absent. */
  minCounterpartyTier: "registered" | "discoverable" | "verified" | "full";

  /** Maximum size, in the smallest unit of the publisher's accepted denomination
      (typically USDC base units, 6 decimals). Recipient-side cap. */
  maxAcceptedSize: bigint;

  /** ERC-20 token addresses the publisher will accept inbound. Empty array = none. */
  acceptedTokens: `0x${string}`[];

  /** Optional. If true, the counterparty's AIP manifest must verify against the
      manifest-signature checked by the TRL. */
  requiredManifestSig?: boolean;

  /** Optional. ISO-8601 expiry. After this timestamp, the policy is treated as absent. */
  validUntil?: string;
}
```

Encoding for storage and transport: canonical JSON (sorted keys, no whitespace, UTF-8). `bigint` values serialize as decimal strings.

A RiskPolicy MUST NOT loosen the router floor. See [Stricter-only invariant](#5-stricter-only-invariant).

### 2. Storage convention

A publisher stores their RiskPolicy in **one** of the following locations, listed in resolution priority order. Resolvers MUST query in this order and stop at the first hit.

#### 2.1 Endpoint override

If the publisher's ENS has the [ENSIP-26](https://docs.ens.domains/ensip/26) `agent-endpoint` text record set, the policy is fetched live from `<endpoint>/policy`. The endpoint MUST serve `application/json` matching the schema above. This path is intended for active agents whose policy may change frequently (e.g., daemons that adapt limits in response to operational conditions).

#### 2.2 ENS text record

If `agent-endpoint` is absent, the resolver checks the `agent-risk-policy` text record on the publisher's ENS. The value is one of:

- An inline canonical-JSON RiskPolicy (when the encoded form is short — implementations SHOULD inline when ≤128 bytes);
- An `ipfs://<cid>` reference, which the resolver dereferences to fetch the RiskPolicy.

#### 2.3 Absent

If neither record is set, the publisher has no RiskPolicy and the router's floor is the only constraint that applies on the publisher's side. Most identities are expected to default here.

### 3. Attestation format

The oracle produces attestations with the following canonical encoding. All `address` types are 20-byte EVM addresses; all `uint256`/`uint8` types follow Solidity ABI conventions; tier values are encoded as `uint8` indices into the enum `{ None=0, Registered=1, Discoverable=2, Verified=3, Full=4 }`.

```solidity
struct Attestation {
  address swapper;
  address recipient;
  TrustTier swapperTier;
  TrustTier recipientTier;
  uint256 expiresAt;   // unix seconds
  uint256 nonce;       // unique per (swapper, oracle) issuance
}
```

The canonical bytes the oracle signs are:

```
keccak256(abi.encode(att))
```

The router verifies an ECDSA signature over those bytes against the oracle's pubkey, fixed at deploy time as `ORACLE_PUBKEY`.

The attestation **does not** bind the quote shape (token addresses, amounts) in v0.1. This is a deliberate trade-off — see [Open questions](#open-questions) for the v1.1 intent to tighten binding.

### 4. Graded-router contract interface

The router contract MUST expose the following entry point. Implementations MAY add introspection helpers, events, or pause functionality.

```solidity
interface IGradedRouter {
  enum TrustTier { None, Registered, Discoverable, Verified, Full }

  struct Attestation {
    address swapper;
    address recipient;
    TrustTier swapperTier;
    TrustTier recipientTier;
    uint256 expiresAt;
    uint256 nonce;
  }

  event GatedSwap(
    bytes32 indexed attestationDigest,
    address indexed swapper,
    address indexed recipient,
    TrustTier effectiveTier,
    uint256 amountIn,
    uint256 feeDeducted
  );

  function gatedSwap(
    bytes calldata downstreamRouterCalldata,
    Attestation calldata attestation,
    bytes calldata oracleSig
  ) external payable;
}
```

Required behavior of `gatedSwap`, in order:

1. Verify the ECDSA signature `oracleSig` over `keccak256(abi.encode(attestation))` against the immutable `ORACLE_PUBKEY`. Revert on failure.
2. Replay protection: maintain `mapping(address => mapping(uint256 => bool)) usedNonce`. Reject reused `(attestation.swapper, attestation.nonce)` pairs.
3. Freshness: `require(block.timestamp <= attestation.expiresAt, "expired")`.
4. Floor: revert if `attestation.swapperTier == None` or `attestation.recipientTier == None`.
5. Compute the effective tier: `effectiveTier = min(attestation.swapperTier, attestation.recipientTier)`.
6. Look up `maxTradeSize(effectiveTier)` and `feeBps(effectiveTier)` from the tier-bucket tables. Revert if the swap input amount exceeds the cap.
7. Deduct the tier-derived fee from the swap input. Implementations choose the fee destination — see [Open questions](#open-questions). The fee MUST be deducted before the call to the downstream router.
8. Forward `downstreamRouterCalldata` to the downstream router (Uniswap Universal Router for the reference implementation), preserving `msg.value`.
9. Emit `GatedSwap` with the attestation digest, parties, effective tier, amount, and fee deducted.

### 5. Tier-bucket terms

Implementations MUST publish their tier-bucket tables openly. The reference implementation uses:

| Tier | `maxTradeSize` (USDC base units, 6 decimals) | `feeBps` |
|---|---|---|
| `None` | revert | n/a |
| `Registered` | 50 × 10⁶ ($50) | 100 (1.00%) |
| `Discoverable` | 500 × 10⁶ ($500) | 50 (0.50%) |
| `Verified` | 5 000 × 10⁶ ($5 000) | 25 (0.25%) |
| `Full` | `type(uint256).max` (unbounded) | 0 |

These values are policy choices, not protocol requirements. A different deployment of the same contract MAY pick different numbers as long as the **monotonicity invariant** holds: higher tier ⇒ higher-or-equal `maxTradeSize` AND lower-or-equal `feeBps`. The invariant prevents adversarial deployments that punish higher trust.

### 6. Stricter-only invariant

A published RiskPolicy can only **restrict** beyond the router's floor — it cannot loosen.

In practice this means:

- `minCounterpartyTier` MUST be ≥ the router's lowest admitted tier (`Registered` in the reference implementation). A RiskPolicy that publishes `minCounterpartyTier: "none"` is rejected at publication time and ignored by the resolver.
- `maxAcceptedSize` MAY be smaller than the publisher's tier-derived cap, never larger. A RiskPolicy that publishes a `maxAcceptedSize` greater than what the publisher's tier admits is clamped down to the tier cap.
- `acceptedTokens` MAY exclude tokens that the router would otherwise admit. It MAY NOT add new tokens (the router has no concept of token allowlists — RiskPolicy is the only place tokens are filtered).

The invariant prevents adversarial publishers from advertising lax preferences to attract spam, gas griefing, or attempt to socially engineer counterparties into oversized exposure.

### 7. Oracle responsibilities

The oracle is a single off-chain service whose pubkey is fixed in the router's constructor. The oracle's role is **honest-but-curious**: it verifies but does not block.

A conformant oracle MUST, on receiving an attestation request:

1. Resolve both sides via the TRL (`@synthesis/resolver` for the reference implementation). Reject the request with HTTP 403 if either side is unresolvable or returns tier `None`. Include an onboarding hint in the response body.
2. Fetch both sides' RiskPolicies per the [storage convention](#2-storage-convention).
3. For each side, verify that the *other* side meets the published RiskPolicy:
   - Counterparty tier ≥ `minCounterpartyTier`
   - Swap input ≤ `maxAcceptedSize` (when this side is the recipient of that token leg)
   - Token in `acceptedTokens` (when this side is the recipient of that token leg)
   - If `requiredManifestSig` is true, verify the counterparty's AIP manifest signature
   - If `validUntil` is set and in the past, the policy is treated as absent
4. If any check fails, return HTTP 403 with a structured diagnostic identifying which RiskPolicy clause failed.
5. If all checks pass, sign the canonical attestation bytes (Section 3) with the oracle's private key and return the attestation + signature.

Multi-oracle threshold signing is out of scope for v0.1. A future revision MAY support a configurable `m-of-n` oracle set in the router's constructor.

### 8. Bidirectional enforcement

The graded-router pattern is bidirectional: both sides' RiskPolicies bind. A swap is admitted only when:

- Swapper's tier satisfies recipient's `minCounterpartyTier` (and vice-versa);
- Recipient's `maxAcceptedSize` is not exceeded;
- The token leg recipients accept matches `acceptedTokens` on each receiving side;
- The router floor admits both sides;
- The stricter-wins join's `maxTradeSize` cap admits the swap input.

The intersection rule is **most restrictive wins**. RiskPolicy enforcement happens **off-chain at attestation-issuance time**: the contract has no awareness of RiskPolicy, only of the tier-bucket terms baked into the attestation. This separation keeps the on-chain contract small and deterministic; RiskPolicy enforcement, which is variable per identity, lives in the oracle.

## Rationale

### Why bucketed tiers, not a continuous trust score?

Bucketing makes the contract's branch space tractable for testing and auditing. Continuous scores would require oracle attestations to embed scalar trust values, which complicates canonicalization and equality. Five buckets covers the operationally-relevant gradations without being so coarse that ordinary use cases force people into the wrong row.

### Why an oracle, not on-chain RiskPolicy verification?

RiskPolicy is variable per identity, mutable, and may live off-chain (endpoint override). Forcing its evaluation on-chain would require either (a) embedding mutable per-identity state in the router (creating storage and update-coordination problems) or (b) requiring every transaction to also carry the relevant policy bytes for verification (ballooning calldata). The off-chain oracle keeps RiskPolicy malleable while keeping the on-chain footprint minimal.

### Why is the floor's denial absolute (`none` reverts), but other tiers are admitted with terms?

The floor encodes the operator's minimum admission standard — typically "is this counterparty resolvable as a real, non-Sybil entity at all?" Below that threshold, no graded terms make sense. Above it, the operator delegates further filtering to graded terms (caps, fees) and to per-identity RiskPolicies. This split keeps the operator's hardcoded position narrow.

### Why doesn't the attestation bind the quote shape?

In v0.1, the attestation binds parties, tiers, freshness, and replay protection — but not the specific token amounts the quote will move. A stolen attestation could be used for a different swap shape than originally intended. This is a deliberate v0.1 simplification — see [Open questions](#open-questions). Tighter binding (per-quote attestations) reduces this attack surface but adds latency to the swap-quote path.

### Why is RiskPolicy opt-in?

Most identities will not publish one. Universal publication would impose a coordination tax. The default — "fall through to router floor" — gives sane minimums without requiring per-user setup. Publication becomes valuable when an identity has specific operational constraints worth advertising (e.g., an agent that only accepts a particular stablecoin, or that caps its exposure to unverified counterparties).

## Backwards compatibility

This convention extends, not replaces, the [synthesis trust-policy spec](https://github.com/estmcmxci/synthesis/blob/main/spec/trust-policy.md):

- The tier vocabulary, `gate()` semantics, and resolution model are inherited unchanged.
- `RiskPolicy` is a new schema. Identities that do not publish one are unaffected; the router floor and tier-bucket terms still apply.
- The attestation format is new; the router contract is new. Existing applications that compose `gate()` directly without the graded router are unaffected.
- The graded router is a wrapper around an underlying DEX router. It does not modify or replace the underlying router; existing consumers of that router are unaffected.

## Security considerations

### Oracle key compromise

The router's only signature check is against `ORACLE_PUBKEY`. A compromised oracle key allows an attacker to issue arbitrary attestations and bypass RiskPolicy enforcement (though the on-chain floor and tier-bucket caps still bind). Mitigations:

- Encrypted at-rest storage for the oracle private key, with platform-level secret masking (Vercel/CF Workers env vars).
- Rotation procedure: a future revision MAY add `ORACLE_PUBKEY` to a configurable set with operator-signed rotation.
- For higher-stakes deployments, multi-oracle threshold signing (post-v0.1) reduces single-key blast radius.

### Replay

Attestations include a `nonce` that the router records as used in `mapping(address => mapping(uint256 => bool))`. Reuse reverts. The oracle MUST issue unique nonces per `(swapper, oracle-instance)` — strict monotonic counters are simplest.

### Freshness

`expiresAt` enforces a hard upper bound on attestation validity. The reference implementation oracle sets `expiresAt = now + 60s` on issuance. Operators should choose an expiry short enough that a leaked attestation has limited utility, but long enough for the swapper to broadcast without race conditions against block production.

### Adversarial RiskPolicy publishing

A publisher might attempt to publish a RiskPolicy that loosens beyond the router's floor (e.g., `minCounterpartyTier: "none"`) to attract gas-grief or spam transactions. The [stricter-only invariant](#5-stricter-only-invariant) blocks this at the resolver layer — the resolver rejects loosening policies and ignores the published value. Implementers MUST enforce this invariant; failure would silently loosen the network's effective floor.

### Front-running and quote-shape mismatch

Because v0.1 attestations do not bind quote shape, a swapper who obtains an attestation could in principle apply it to a different swap (different tokens or amounts) than the oracle re-validated. The on-chain caps still bind the swap input. The mitigation in v0.1 is short attestation expiry; the cleaner fix is to bind quote shape into the attestation in v1.1.

### Oracle availability

A single oracle is a single point of failure. If the oracle is offline, no swaps can broadcast through the router. Operators SHOULD plan for oracle redundancy out-of-band (warm standby, multiple regions). A future revision MAY add multi-oracle threshold signing to remove this dependency.

### Fee destination governance

The router deducts a fee per the tier-bucket table. The destination is a policy choice. The reference implementation routes the fee to the oracle operator (to fund hosting and key custody); other deployments MAY route to a treasury, burn, or split. This is intentionally not specified — operators document their choice in their deployment.

## Reference implementation

The reference implementation lives at [`estmcmxci/trust-swap`](https://github.com/estmcmxci/trust-swap):

- Solidity router: `packages/contracts/src/TrustSwapRouter.sol` (Phase 2)
- Off-chain oracle: `packages/oracle/` (Phase 1 skeleton, Phase 2 attestation logic)
- RiskPolicy schema + resolver: `packages/core/risk-policy.ts` (Phase 1)
- Tier-bucket TS mirror: `packages/core/policy.ts` (Phase 1)
- CLI: `tru policy publish`, `tru policy show`, `tru swap` (Phases 1 + 3)

The reference implementation deploys the router via CREATE2 to a deterministic address on Base mainnet, so consumer applications can pin to that address before deploy time.

## Open questions

The following are explicitly under-specified in v0.1 and are expected to be resolved in v1.1:

1. **Quote-shape binding in attestations.** Should the attestation bind `(swapper, recipient, expiresAt, nonce)` only, or also `(tokenIn, tokenOut, amountInMax)`? Tighter binding reduces stolen-attestation attack surface but adds latency. v0.1 uses loose binding; v1.1 likely tightens.
2. **Oracle decentralization.** Single oracle in v0.1; multi-oracle threshold signing is the obvious next step.
3. **Fee destination convention.** Currently a per-deployment choice; whether to standardize a default is open.
4. **Per-pool oracle configuration.** Currently one oracle per router; whether a router could route different pool-class swaps to different oracles is open.
5. **Negotiation protocol.** When a RiskPolicy mismatch causes a 403, the swapper sees the diagnostic and can resubmit (e.g., at a clamped amount). A structured negotiation protocol where sides exchange counter-offers is out of scope for v0.1.
6. **Continuous vs bucketed tiers.** Bucketed for v0.1; whether to support a continuous-score variant of the same convention is open.

## References

- [`@synthesis/resolver` trust-policy spec](https://github.com/estmcmxci/synthesis/blob/main/spec/trust-policy.md) — the substrate this convention extends.
- [ENSIP-26 — Resolver Endpoint Interface](https://docs.ens.domains/ensip/26) — used as the storage path for `agent-endpoint`.
- [`PLAN.md`](../PLAN.md) — TrustSwap execution plan and component overview.
- [Uniswap Universal Router](https://docs.uniswap.org/contracts/universal-router/overview) — the downstream router used by the reference implementation.
- [ERC-191 / EIP-712](https://eips.ethereum.org/EIPS/eip-712) — referenced for the canonical-bytes signing convention.
