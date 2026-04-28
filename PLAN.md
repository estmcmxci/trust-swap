# TrustSwap — Reputation-Graded Settlement on Uniswap

A programmable trust layer between any two parties and the Uniswap pools they use. Every swap routes through `TrustSwapRouter`, an on-chain contract that verifies an off-chain trust attestation and applies **tier-graded execution terms** before forwarding to Uniswap's Universal Router. The novel primitive is **reputation-graded settlement** — the trust score is both an enforcement signal (tier-bucketed limits) and a preference signal (each side publishes a RiskPolicy describing what counterparties they'll accept).

Targets two hackathon prize tracks from one codebase:

- **OpenAgents ENS — Best Integration for AI Agents** ($2,500 / $750 / $500)
- **Uniswap Foundation — Best API Integration** ($2,500 / $1,500 / $1,000)

## Positioning

One-line pitch: **reputation-graded settlement — settle with anyone the chain says you should.**

Five primitives compose, each doing one job:

| Layer | Provider | Job |
|---|---|---|
| **TRL substrate** | `@synthesis/resolver` (read-only) | "Resolve `<ens>` to a 5-layer `TrustProfile`." |
| **TrustSwap Oracle** | This repo (off-chain signing service) | "Re-resolve both sides, check published RiskPolicies, sign an attestation." |
| **TrustSwapRouter** | This repo (Solidity, on-chain) | "Verify the oracle signature, look up tier-bucket terms, forward to Universal Router." |
| **Uniswap Trading API** | Uniswap Foundation | "Generate optimal swap calldata for the underlying pools." |
| **Wallet / session-key policy** | `@namera-ai/sdk` over ZeroDev | "Bound what the session key can call, with what value, how often." |

The router ensures a swap satisfies the *intersection* of (router floor, swapper's tier-derived terms, recipient's published RiskPolicy). Most restrictive wins. Tier `none` is the only outright admission denial — every other tier is admitted with graded terms.

## Why this hits both prize tracks

### ENS — Best Integration for AI Agents

Verbatim prize prompt: *"resolving the agent's address, storing its metadata, gating access, enabling discovery, or coordinating agent-to-agent interaction."*

| Prompt clause | TrustSwap satisfaction |
|---|---|
| Resolving the agent's address | `viem.getEnsAddress` on every counterparty, every swap |
| Storing metadata | `agent-risk-policy` ENS text record — published per-identity |
| Gating access | The router applies graded terms; tier `none` revoked outright; counterparty RiskPolicy applies additional restrictions |
| Enabling discovery | `/swap` page resolves and renders the recipient's full TRL profile + their RiskPolicy inline |
| Coordinating agent-to-agent | Two daemons negotiate autonomously: each fetches the other's RiskPolicy, both must satisfy the other's stated requirements before settlement |

### Uniswap Foundation — Best API Integration

Verbatim prize prompt: *"Agents that trade, coordinate with other agents, or invent primitives we haven't imagined yet."*

| Prompt axis | TrustSwap satisfaction |
|---|---|
| Real onchain execution | Trading API generates the swap calldata; our `TrustSwapRouter` wraps it on Base mainnet |
| Agentic context | Long-lived daemon on a remote VM signs swaps autonomously inside session-key policy bounds + router-enforced trust bounds |
| Coordinate with other agents | Two ENS-named agents discover each other's RiskPolicy via ENS, gate each other bidirectionally, settle through the same shared router |
| **Novel primitive** | **"Reputation-graded gated routing" — a programmable trust layer in front of any AMM**, with bidirectional preference signaling. Other Trading API consumers can adopt the gated-router pattern (Solidity contract in this repo) or the off-chain attestation model (oracle service spec) independently. |
| FEEDBACK.md substance | We compose, not just call — the doc surfaces real friction (no native ENS in API inputs, attestation-to-quote binding gaps, etc.) |

## System architecture

```
┌────────────────────────────────────────────────────────────────┐
│  USER / AGENT                                                  │
│   • CLI:   tru swap <recipient.eth> --amount <n>               │
│   • Site:  /swap (Next.js)                                     │
│   • MCP:   trust-swap-mcp tool "trust_gated_swap"              │
│   • Daemon: tru agent run (long-lived loop on a VM)            │
└──────────────────────────┬─────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
┌──────────────┐  ┌──────────────────┐  ┌────────────────────┐
│ TRL resolve  │  │ RiskPolicy fetch │  │ Trading API quote  │
│ (synthesis)  │  │ (resolver utility)│ │ (Uniswap)          │
└──────┬───────┘  └────────┬─────────┘  └──────────┬─────────┘
       │                   │                       │
       └───────────────────┴───────────────────────┘
                           │
                           ▼
              ┌────────────────────────────┐
              │  TrustSwap Oracle (HTTP)   │
              │  • re-resolves both sides  │
              │  • checks RiskPolicy match │
              │  • signs attestation       │
              └─────────────┬──────────────┘
                            │  attestation + sig
                            ▼
              ┌────────────────────────────┐
              │  Session-key signer        │
              │  (Namera / ZeroDev kernel) │
              │  Onchain: toCallPolicy     │
              │           pinned to Router │
              └─────────────┬──────────────┘
                            │  user op
                            ▼
        ┌────────────────────────────────────────────┐
        │   TrustSwapRouter (on Base mainnet)        │
        │   1. Verify oracle sig + freshness         │
        │   2. Lookup tier-bucket terms (table):     │
        │        none      → REVERT (floor)          │
        │        registered → cap $50,    fee 1.0%   │
        │        discoverable → cap $500,  fee 0.5%  │
        │        verified   → cap $5k,    fee 0.25%  │
        │        full       → unbounded,  fee 0%     │
        │   3. Apply stricter-wins join (counterparty)│
        │   4. Forward to Universal Router           │
        └─────────────────────┬──────────────────────┘
                              │
                              ▼
        ┌────────────────────────────────────────────┐
        │   Uniswap Universal Router (Base mainnet)  │
        │   0x6ff5693b9...d299b43                    │
        └────────────────────────────────────────────┘
```

## Components

### 1. TRL substrate — `@synthesis/resolver@0.2.0` (consumed)

Read-only library. Provides `resolve(ensName) → TrustProfile`, the `gate()` policy primitive, the `Signer` interface (`createLocalSigner` + `createNameraSigner`), and the `ensemble gate` CLI for inspection. Already shipped via the synthesis Layer A PRs (#27–30). TrustSwap consumes via `file:../synthesis/packages/resolver` during dev; npm-published version pre-judging.

### 2. TrustSwap Oracle service (NEW — `packages/oracle`)

A small HTTP service that signs attestations. Run by the TrustSwap project (single oracle for the hackathon — the router's constructor stores the oracle's pubkey).

```typescript
POST /attest
{ swapper, recipient, tokenIn, tokenOut, amountIn }
→ { attestation, signature }
  attestation: { swapper, recipient, swapperTier, recipientTier, expiresAt, nonce }
```

Internals:
1. Re-resolve `swapper` and `recipient` via `@synthesis/resolver`
2. If either is tier `none` → refuse (return 403 with onboarding hint)
3. Fetch each side's RiskPolicy (text record `agent-risk-policy`, or endpoint override)
4. Verify each side meets the other's RiskPolicy (`minCounterpartyTier`, `maxAcceptedSize`, `acceptedTokens`, `requiredManifestSig`)
5. Sign the attestation with the oracle's private key (kept in env var; rotation policy in spec)
6. Return signed attestation

The oracle is honest-but-curious: it signs only after re-validating both sides. The router accepts only attestations signed by the registered oracle pubkey. Future versions can support multiple oracles via threshold signing — out of scope for v1.

Hosted on Vercel/Cloudflare Workers. Source: `packages/oracle/`.

### 3. TrustSwapRouter — Solidity contract (NEW — `packages/contracts`)

The on-chain enforcement layer. ~150 LoC plus tier-bucket tables.

```solidity
contract TrustSwapRouter {
  address public constant UNIVERSAL_ROUTER = 0x6ff5693b9...;
  address public immutable ORACLE_PUBKEY;

  enum TrustTier { None, Registered, Discoverable, Verified, Full }

  struct Attestation {
    address swapper;
    address recipient;
    TrustTier swapperTier;
    TrustTier recipientTier;
    uint256 expiresAt;
    uint256 nonce;
  }

  function gatedSwap(
    bytes calldata universalRouterCalldata,
    Attestation calldata attestation,
    bytes calldata oracleSig
  ) external payable {
    // 1. Verify oracle signature over canonical attestation bytes
    // 2. Replay protection (nonce table per swapper)
    // 3. Freshness: block.timestamp <= attestation.expiresAt
    // 4. Floor: revert if either tier == None
    // 5. Tier-bucket caps: stricter-wins join across both sides
    // 6. Compute fee, deduct, route remainder
    // 7. Forward to Universal Router
    // 8. Forward output tokens to recipient
  }

  function maxTradeSize(TrustTier tier) internal pure returns (uint256) {
    if (tier == TrustTier.Full)         return type(uint256).max;
    if (tier == TrustTier.Verified)     return 5000e6;     // $5k
    if (tier == TrustTier.Discoverable) return 500e6;
    if (tier == TrustTier.Registered)   return 50e6;
    revert("tier=none not eligible");
  }

  function feeBps(TrustTier tier) internal pure returns (uint256) {
    if (tier == TrustTier.Full)         return 0;
    if (tier == TrustTier.Verified)     return 25;     // 0.25%
    if (tier == TrustTier.Discoverable) return 50;
    return 100;                                         // 1.0%
  }
}
```

**Two knobs (locked in for v1):** `maxTradeSize` and `feeBps`, both per-tier.

**Floor:** `tier == None` reverts. The four other tiers are admitted with graded terms.

**Stricter-wins join:** when both swapper and recipient have tiers, the router uses `min(swapperTier, recipientTier)` for both knobs.

**Foundry** for tests + deployment. Single deployment to Base mainnet during Phase 2.

### 4. RiskPolicy (NEW — schema + storage)

Per-identity *opt-in* preference, published on the identity's ENS:

```typescript
interface RiskPolicy {
  minCounterpartyTier: TrustTier;     // "I won't transact with anyone below this"
  maxAcceptedSize: bigint;            // "Cap their swap-in to me at $X"
  acceptedTokens: address[];          // "I'll accept these tokens, not others"
  requiredManifestSig?: boolean;      // "Counterparty's manifest must verify"
  validUntil?: number;                // optional expiry
}
```

**Storage (in priority order):**
1. **Endpoint override** — if the identity has an `agent-endpoint` ENSIP-26 record, fetch RiskPolicy from `<endpoint>/policy` (live, real-time updatable). Used by active agents.
2. **ENS text record** — fetch from text record `agent-risk-policy` on the identity's ENS. Either inline JSON or `ipfs://...` reference. Used by passive identities.
3. **Default (absent)** — if neither, the router's floor is the only constraint. Most identities default here.

The oracle does the fetch as part of the attestation flow. The router itself has no awareness of RiskPolicy — it only enforces the tier-bucket terms baked into the attestation. RiskPolicy enforcement happens **off-chain at attestation-issuance time**: if either side fails the other's RiskPolicy, the oracle refuses to sign, full stop.

**Key constraint (per spec):** RiskPolicy can only be **stricter** than the router's floor. It cannot loosen — a recipient cannot publish "minCounterpartyTier: none" to attract gas-griefing or spam.

### 5. Trading API client — `packages/core/trading.ts`

Thin wrapper around `https://trade-api.gateway.uniswap.org/v1`. Returns the Universal Router calldata that gets passed *into* `TrustSwapRouter.gatedSwap()`. Same shape as planned in framing 1, just no longer the final on-chain call — it's input to our router.

For v1 we implement: `checkApproval`, `quote`, `swap`, `swapStatus`, `swappableTokens`. Routing-aware `permitData` handling (UniswapX excludes from /swap; CLASSIC requires sig+permitData together or neither). Validates response shape before returning. Typed errors for quote-expired, slippage-exceeded, insufficient-liquidity, 429 rate-limited.

The client does no signing. It returns a `SwapTransaction` that becomes the `universalRouterCalldata` argument to the router's `gatedSwap()` function.

### 6. Orchestration — `packages/core/orchestrate.ts`

The load-bearing composition. Pure async function, reused by CLI / server actions / daemon / MCP.

```typescript
orchestrate({
  recipientEns, tokenIn, tokenOut, amount, signer,
  callerEns,
}) → {
  decision,                    // local pre-flight gate (synthesis gate())
  recipientRiskPolicy,         // fetched
  attestation?,                // from oracle
  attestationSignature?,       // from oracle
  routerCalldata?,             // gatedSwap(...) calldata
  txHash?,                     // after broadcast
  clampApplied?,               // if router-imposed cap was hit
  onboardingHint?,             // if denied for tier reasons
}
```

Steps:
1. Resolve recipient via TRL → `TrustProfile` + tier
2. Fetch recipient's RiskPolicy (endpoint or text record or default)
3. Local pre-flight: apply `gate()` for early diagnostic + onboarding hints (but the oracle is the authority)
4. Request attestation from oracle (`POST /attest`)
5. Fetch quote + swap calldata from Trading API
6. Build `gatedSwap()` calldata: `{ universalRouterCalldata, attestation, oracleSig }`
7. Sign + broadcast via `signer.execute([batch])` (Namera kernel account preferred for atomic batching)
8. Return full diagnostic record

### 7. CLI — `packages/cli` (the `tru` binary)

```bash
tru swap <recipient.eth> \
  --token-in <symbol|address>     # default USDC
  --token-out <symbol|address>    # default WETH
  --amount <n>                    # human units
  --chain <name>                  # default base
  --signer namera|local           # default namera if NAMERA_KEYSTORE_PATH set
  --dry-run                       # do everything except broadcast

tru policy publish \
  --min-tier <tier>               # required; default verified
  --max-size <usd>                # required
  --tokens <comma-list>           # required
  --require-manifest-sig          # optional
  --valid-until <iso8601>         # optional
  # Updates the agent-risk-policy ENS text record on YOUR ENS

tru policy show <ens>             # prints another agent's published RiskPolicy

tru agent run \
  --policy <policy.json>          # operator-side policy + signal source
  --interval <seconds>            # default 60
  --max-iterations <n>            # default unbounded
```

`tru` is a separate binary from `ensemble` — they share `@synthesis/resolver` as a library but ship as independent CLIs (Ensemble is the substrate, Tru is one application of it).

### 8. Site — `packages/site`

Next.js. Three pages:

- **`/swap`** — recipient input, amount input, live trust card (5 layer badges + tier ribbon), recipient's RiskPolicy displayed inline ("This agent accepts: USDC, USDT; min tier: verified; max size: $2k"), router-derived clamps shown as preview ("Your tier `verified` caps this swap at $5k; Bob's RiskPolicy further caps at $2k → effective max: $2k"), gate-bound action button.
- **`/policy`** — your own RiskPolicy editor; signs + publishes to your ENS text record.
- **`/agent`** — daemon dashboard (Phase 5). Live SSE log tail, kernel account state, last 10 attempts.

### 9. MCP server — `packages/mcp`

Exposes `trust_gated_swap` as an MCP tool. Same parameters as `tru swap`. Distribution surface so any MCP-aware host (Claude, GPT, Bankr) can call TrustSwap. Public-good claim: every MCP host gets reputation-graded settlement for free.

### 10. spec/trust-graded-swap.md

Formal convention spec for the graded-router pattern + RiskPolicy schema. See companion document at `spec/trust-graded-swap.md` (created in Phase 1). Pitched as a future ENSIP if adoption extends beyond TrustSwap.

## File layout

```
trust-swap/
├── PLAN.md                                this file
├── README.md                              one-paragraph pitch
├── FEEDBACK.md                            Uniswap prize requirement
├── spec/
│   └── trust-graded-swap.md               graded mode + RiskPolicy convention
├── packages/
│   ├── core/                              Trading API client + orchestrate + policy table + RiskPolicy fetcher
│   ├── cli/                               tru binary (swap, policy, agent run)
│   ├── site/                              Next.js (/swap, /policy, /agent)
│   ├── mcp/                               MCP server
│   ├── contracts/                         Solidity (TrustSwapRouter + Foundry tests + deploy script)
│   └── oracle/                            HTTP signing service (Vercel/CF Workers)
└── infra/
    └── droplet/                           systemd unit + cloud-init for Phase 5
```

## Build sequence

Critical path is everything through Phase 4. Phases 5 + 6 are stretch but Phase 6 (A2A) is the demo headline — fold it in only after the underlying tier-graded router is live + bidirectional RiskPolicy works.

### Phase −1.A — Synthesis primitives shipped (DONE)

`@synthesis/resolver@0.2.0` and `@synthesis/cli@0.2.0` ship `gate()`, `Signer`, `createLocalSigner`, `createNameraSigner`, `Batch`, `TrustPolicy`, `GateDecision`, and the `ensemble gate` CLI. Reference: synthesis-md/Trust Resolution Layer project, PRs #27–30.

### Phase −1.B — Repo scaffold (DONE)

pnpm workspace, four package skeletons (`core`, `cli`, `site`, `mcp`), `@synthesis/resolver` wired as `file:` dep, `tru` binary smoke-tested. At commit `e778bc8`.

### Phase 0 — Operational readiness (Day 1, half day)

- [ ] Audit live ENS reads on Base via `ensemble trust emilemarcelagustin.eth`
- [ ] Register `UNISWAP_API_KEY` at developers.uniswap.org
- [ ] Provision Base ERC-4337 bundler (`BUNDLER_URL_BASE`)
- [ ] Smoke-test Uniswap API key with `/quote`
- [ ] Smoke-test bundler with `eth_supportedEntryPoints`
- [ ] Add `NAMERA_*` env placeholders to `.env.example`
- [ ] Provision + fund kernel account (createAccountClient ECDSA)
- [ ] Encrypt owner key into `~/.synthesis/keystore.json`
- [ ] **NEW:** Generate TrustSwap oracle keypair, save private key encrypted, record pubkey for the router constructor
- [ ] **NEW:** Provision Vercel/Cloudflare Workers project for the oracle service deployment

### Phase 1 — TypeScript foundation (Day 2, full day)

The off-chain code that everything else builds on. No Solidity yet, no router yet. The CLI runs against a *mocked* oracle + *mocked* router for early validation.

- [ ] Add `packages/contracts` package skeleton (Foundry config, will be filled in Phase 2)
- [ ] Add `packages/oracle` package skeleton (HTTP service shell)
- [ ] Implement `packages/core/trading.ts` — Trading API client
- [ ] Implement `packages/core/policy.ts` — `defaultSwapPolicy` + tier-bucket TABLE (mirrors the Solidity contract's table; both ship from this single source of truth)
- [ ] Implement `packages/core/risk-policy.ts` — `RiskPolicy` Zod schema + `resolveRiskPolicy(ensName)` utility (endpoint override → text record → default)
- [ ] Implement `packages/core/orchestrate.ts` — full composition with mocked oracle/router
- [ ] Issue first Namera session key with `toCallPolicy` pinned to the *future* TrustSwapRouter address (compute deterministically via CREATE2 salt; reissue if the deploy address changes)
- [ ] Implement `packages/cli/src/commands/swap.ts` — wires orchestrate to CLI
- [ ] E2E CLI dry-run: `tru swap testname.eth --amount 0.5 --signer local --dry-run` runs end-to-end (against mocked oracle+router)

### Phase 2 — Solidity router + Oracle service + first live broadcast (Day 3–4, two days)

The Solidity engagement. Where the real on-chain footprint lands.

- [ ] Foundry setup: `forge init` inside `packages/contracts`, `foundry.toml`, dependencies (forge-std, openzeppelin)
- [ ] Implement `packages/contracts/src/TrustSwapRouter.sol` — full contract per Component 3 above
- [ ] Foundry tests:
  - Tier-floor revert (tier=none)
  - Tier-bucket cap enforcement (each of registered/discoverable/verified/full)
  - Stricter-wins join (asymmetric tiers between swapper + recipient)
  - Oracle signature verification (good sig accepts; bad sig reverts)
  - Replay protection (nonce reuse reverts)
  - Freshness (expired attestation reverts)
  - Fee deduction math (each tier)
  - Universal Router forward (mocked target — ensure data is forwarded byte-perfect)
- [ ] Implement `packages/oracle/` — HTTP signing service
  - `POST /attest` route
  - Re-resolves via `@synthesis/resolver`
  - Fetches both RiskPolicies via `core/risk-policy.ts`
  - Returns 403 + onboarding hint for tier=none or RiskPolicy mismatches
  - Signs with oracle key from env
- [ ] Deploy oracle to Vercel/CF Workers (env vars set, key never logged)
- [ ] Deploy `TrustSwapRouter` to Base mainnet via Foundry script (`forge script ... --broadcast`)
- [ ] Replace mocks in `orchestrate.ts` with real oracle URL + real router address
- [ ] First real swap: `tru swap testname.eth --amount 0.5 --signer local` end-to-end through the deployed router. Verify on BaseScan.
- [ ] Repeat with `--signer namera` (atomic approve+swap+gatedSwap as a single user op)
- [ ] Update `FEEDBACK.md` — Trading-API-into-custom-router composition observations

### Phase 3 — RiskPolicy + bidirectional + tru policy publish (Day 5, full day)

Complete the bidirectional story. Both sides have published preferences; both sides' preferences enforce.

- [ ] Implement `packages/cli/src/commands/policy.ts` — `tru policy publish` + `tru policy show`
- [ ] `tru policy publish` writes to the user's `agent-risk-policy` ENS text record (using a write-side flow — needs the user's ENS controller key, but only for the publish step)
- [ ] Smoke-test: publish a RiskPolicy on a test ENS, fetch it back via `resolveRiskPolicy()`, assert round-trip integrity
- [ ] Update `orchestrate.ts` to fetch the recipient's RiskPolicy unconditionally (not just defaulted) and surface the "you don't meet their bar" diagnostic with onboarding hints
- [ ] Update oracle to enforce *both* sides' RiskPolicies (was already in Phase 2; verify here with end-to-end test)
- [ ] Negative path tests:
  - Recipient publishes `minCounterpartyTier: full`; tier=verified swapper rejected at oracle with clear diagnostic
  - Recipient publishes `maxAcceptedSize: $100`; swapper requesting $500 sees clamp diagnostic, can resubmit at $100 or abort
  - Recipient with no RiskPolicy → falls through to router floor only
- [ ] FEEDBACK.md updated with bidirectional-attestation observations

### Phase 4 — Site UI (Day 6, full day)

The screen-share artifact. No new on-chain work — surfaces what Phases 1–3 already built.

- [ ] `/swap` page: recipient ENS input, amount input, live trust card (lifted from synthesis `/trust`), recipient's RiskPolicy displayed inline, router-derived clamps shown as preview, gate-bound action
- [ ] `/policy` page: editor for your own RiskPolicy, signs + publishes
- [ ] `/api/gate` server action — public endpoint
- [ ] Token picker from Trading API swappable-tokens
- [ ] Screenshot tests for: tier-none deny, RiskPolicy mismatch deny, clamp-applied success, A2A pre-flight pass

### Phase 5 — Droplet daemon (Day 7, full day) — STRETCH

- [ ] DigitalOcean (or Fly.io) droplet provisioned, cloud-init.yaml in `infra/droplet/`
- [ ] systemd unit running `tru agent run`
- [ ] `/agent` page on the site shows live SSE log tail
- [ ] Trigger a signal, watch the daemon resolve → fetch RiskPolicy → request attestation → broadcast through router on screen

### Phase 6 — A2A coordination (Day 8, full day) — STRETCH (demo-central)

The headline demo flow. Two daemons under separate ENS names negotiating via the same router.

- [ ] Second droplet under `bob-data.eth` (first under `alice-research.eth`)
- [ ] Each daemon publishes its RiskPolicy via `tru policy publish`
- [ ] Each daemon exposes `POST /intents` (TLS); endpoint URL stored in `agent-endpoint` ENS text record
- [ ] **Demo flow:** `bob-data.eth` posts intent → `alice-research.eth`'s daemon polls intents → resolves Bob via TRL → fetches Bob's RiskPolicy → checks Alice meets it → requests attestation from oracle → oracle re-validates both sides → signs → Alice signs+broadcasts through router → Bob's daemon sees incoming USDC → triggers downstream action
- [ ] All happens autonomously while we watch on `/agent`

### Cut lines (in order)

1. Cut Phase 6 (A2A) — single-daemon Phase 5 still demos autonomy + graded terms
2. Cut Phase 5 (droplet daemon) — run from a laptop during demo
3. Cut MCP server — CLI alone is enough for the public-good claim
4. Cut Namera-only session-key flow, fall back to `--signer local`
5. Cut second knob (fee tier) — keep just maxTradeSize for v1
6. Cut RiskPolicy entirely — fall back to router-floor-only mode (loses the bidirectional story; do not cut unless absolutely required)

## Demo script (90 seconds)

The Alice / Bob anecdote in compressed form.

```
[0:00–0:20]  Open /swap. Type "bob-data.eth" into recipient.
             Trust card resolves: tier verified, 4/5 layers green.
             Below it, Bob's RiskPolicy renders: "accepts USDC up to $500
             from agents at tier verified+". Default amount $200 USDC →
             swap button enabled with green ALLOW banner. Sign and
             broadcast. BaseScan link.

[0:20–0:35]  Replace recipient with "m-bot.eth" — fresh ENS, tier none.
             Trust card lights up red. Swap button shows the deny diagnostic
             with onboarding hint: "register on AgentBook for personhood
             (tier none → registered) to participate."

[0:35–0:55]  Replace with "tampered.eth" — same address as a known good
             name, but with a manifest signature mismatch. Tier drops
             from full to discoverable. Their RiskPolicy field "requires
             verified counterparty" now blocks our swap (we're full, but
             they require verified manifest sig and ours has been tampered).
             Diagnostic: "manifest signature does not match current ENS owner."

[0:55–1:25]  Switch to /agent. The daemon dashboard. Live log tail shows
             alice-research.eth and bob-data.eth negotiating overnight:
             three settlements at $200, $500, $200 — each with the
             attestation, the oracle's RiskPolicy check, the router's
             tier-bucket lookup. Click through to BaseScan: real swaps,
             real value, all routed via TrustSwapRouter → Universal Router
             → Base pools. The daemons did this without us awake.

[1:25–1:30]  Close: "Five primitives — TRL for who, RiskPolicy for what
             you'll accept, Oracle for the proof, Router for enforcement,
             Uniswap for the move. Reputation-graded settlement."
```

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Foundry / Solidity learning curve eats more time than budgeted | High | Bound Phase 2 to 2 days. If overrun, cut to Phase 1's mocked-router path and demo with that (no on-chain footprint, same UX). |
| Oracle key leak | Medium impact | Encrypt at rest in env vars. Rotate post-hackathon if exposed. Single-oracle design accepts this risk for v1. |
| Pimlico/Alchemy bundler downtime | Medium | Two bundler URLs in env; auto-failover. |
| ZeroDev validator install fails | Medium | Pre-install during Phase 2. Compute router address via CREATE2 deterministically so session key's toCallPolicy pin matches the actual deploy. |
| Trading API rate-limits during demo | Low | Cache one successful quote+swap pair as backup; record video as final fallback. |
| Droplet networking flakiness on stage | Medium | Mirror daemon log to site via SSE. Site (Vercel) is the screen-share target. |
| TRL resolver returns stale data for freshly-set ENS | Medium | Set all demo records ≥24h before judging. Pre-warm IPFS pin. |
| AIP manifest layer broken in synthesis | Low (already shipped) | Fixed via PRs #27–30. Re-verify at Phase 0 sanity check. |
| Judges interpret "agent" narrowly as "LLM-driven" and we don't have an LLM in the swap path | Low | MCP server makes any LLM a TrustSwap host. Demo a Claude session calling the MCP tool if needed. |
| Reputation-graded routing seen as "just a Permit2 variant" | Low | Lead with the bidirectional RiskPolicy story — no Permit2 variant has counterparty preferences as a first-class signal. |
| Session key leaks from droplet | Low impact | Onchain `toCallPolicy` pinned to TrustSwapRouter only — at most 1 swap/hour, ≤$5 gas, expires in 24h. Time-bound expiry is the primary safeguard. |
| RiskPolicy adversarial publishing (e.g. `minCounterpartyTier: none, maxSize: ∞`) attracts spam | Low | Router enforces its own floor regardless of RiskPolicy. RiskPolicy can only further restrict, never loosen. Documented in spec. |

## Public-good × reference-spec deliverables

Five artifacts other projects can fork:

1. **`@synthesis/resolver@0.2.0`** — already shipped (Layer A). The TRL primitives any reputation-graded app can build on.
2. **`TrustSwapRouter` Solidity contract** — open-source. Other Trading API consumers can deploy their own variants with different tier tables, different oracle pubkeys, different RiskPolicy enforcement.
3. **TrustSwap Oracle reference implementation** — open-source. Anyone can run their own oracle for their own router.
4. **`spec/trust-graded-swap.md`** — formal convention. RiskPolicy schema + storage convention (ENS text record `agent-risk-policy`). Pitched as future ENSIP.
5. **TrustSwap MCP server (`trust-swap-mcp`)** — distribution surface. Every MCP-aware LLM host gets reputation-graded settlement for free.

## Out of scope

Explicitly not in v1:

- v4 hook deployment (the conceptually-purest framing — Solidity-heavy, would need separate pool deployment, LP bootstrap)
- Multi-oracle threshold signing (decentralization of the oracle)
- ZK proofs of off-chain resolution (research-territory, not for hackathon)
- More than two knobs (max size + fee). Slippage caps, cooldowns, gas sponsorship, etc. are post-v1.
- Continuous trust score (vs bucketed tiers). Bucketed wins for v1 simplicity.
- RiskPolicy negotiation protocol (sides can update their RiskPolicy + retry; structured negotiation is post-v1).
- Per-pool oracle configuration (one oracle for v1).
- Cross-chain routing (single chain — Base — for v1).
- x402 paywall composition (distinct project, possible follow-up).
- Anonymous trust proofs (TRL today is fully transparent).

## Open questions before coding

1. **Router fee destination.** Where does the fee go? Three options: (a) sent to the oracle operator (us, for hackathon), (b) burned, (c) returned to the recipient as a "trust dividend." Lean toward (a) for hackathon — funds the oracle hosting. Document clearly.
2. **Attestation binding scope.** Should the attestation bind `(swapper, recipient, expiresAt)` only, or `(swapper, recipient, tokenIn, tokenOut, amountInMax, expiresAt)`? Tighter binding means re-attestation per quote (cost: latency); looser binding means one attestation can be reused for multiple swap shapes (cost: a stolen attestation could be used differently than intended). **My take:** loose binding for hackathon; tighten in v1.1.
3. **CREATE2 salt for router deployment.** Compute the deterministic address before Phase 2 deploy so the Phase 1 session-key issuance can pin `toCallPolicy` to the correct future address. Manual coordination — script the salt mining.
4. **`@synthesis/resolver` extension.** Should `resolveRiskPolicy()` live in the synthesis resolver (generic) or in `@trust-swap/core` (app-specific)? **My take:** in `@trust-swap/core` for hackathon. Promote to synthesis if a second consumer adopts the RiskPolicy pattern.

## See also

- [`README.md`](./README.md) — one-paragraph pitch (will need refresh post plan revision)
- [`FEEDBACK.md`](./FEEDBACK.md) — Uniswap prize requirement
- [`spec/trust-graded-swap.md`](./spec/trust-graded-swap.md) — graded mode + RiskPolicy convention (to be written next)
- [`@synthesis/resolver`](https://github.com/estmcmxci/synthesis/tree/main/packages/resolver) — TRL substrate
- [`spec/trust-policy.md`](https://github.com/estmcmxci/synthesis/blob/main/spec/trust-policy.md) — synthesis-side `gate()` convention (we extend, not replace)
