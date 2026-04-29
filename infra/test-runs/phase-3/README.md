# Phase 3 — TRU-66 oracle bidirectional verification

This directory captures the live oracle's response to a fixed set of
attestation requests. Run via `pnpm test:phase-3`. Re-running overwrites the
JSON artifacts; the most recent run is what's checked in.

## Setup that lives on chain

- **`emilemarcelagustin.eth`** — verified TRL profile, **no published
  RiskPolicy**.
- **`kernel.emilemarcelagustin.eth`** — inherits the parent's tier; has a
  RiskPolicy text record:
  - `minCounterpartyTier: "registered"`
  - `maxAcceptedSize: 100_000_000n` (= $100 in 6-decimal USDC base units)
  - `acceptedTokens: [USDC]`
  - Published in tx `0x4c73ca73…51191`
    ([etherscan](https://etherscan.io/tx/0x4c73ca73ba4ffacc459b3ce4d9880f9731d1774d83ed8b1d59a9e0fb46351191)).

## Direction tested

`emilemarcelagustin.eth` (parent, **swapper**) → `kernel.emilemarcelagustin.eth`
(kernel, **recipient**). The recipient-side branch of the oracle's
bidirectional check fires fully against the kernel's published policy. The
swapper-side branch no-ops because the parent has no published RiskPolicy.

## What's covered

| Scenario                   | Asserts                                                                                  | Outcome |
| -------------------------- | ---------------------------------------------------------------------------------------- | ------- |
| `A-pass`                   | $1 USDC inbound, kernel's policy fully satisfied → 200                                   | ✓       |
| `B-recipient-size-reject`  | $200 inbound > maxAcceptedSize $100 → 403, size error                                    | ✓       |
| `C-recipient-token-reject` | DAI inbound, USDC-only accept-list → 403, token error                                    | ✓       |
| `D-no-policy-fallthrough`  | TRU-69 — recipient (parent) has no policy → recipient-side check no-ops, oracle signs    | ✓       |

The recipient policy's three enforcement branches are each exercised by a
real HTTP call to the deployed oracle (`trust-swap-oracle.estmcmxci.workers.dev`).
The success case returns a verifiable EIP-191 signature over the canonical
attestation tuple.

## Coverage gaps (deliberate)

- **Swapper-side enforcement** — the oracle's `fromRecipientToSwapper` check
  (size, token, tier on the swap output direction) is not exercised here
  because the parent has no published RiskPolicy. Tracked as a follow-up
  to publish a parent policy when there's a concrete reason to.
- **Recipient-tier enforcement** — both ENS profiles in the test resolve
  to `verified+`, so we can't construct a tier-reject case without
  publishing a stricter policy. Left for the follow-up above.
- **`requireManifestSig`** — no policy in the suite sets this flag.
- **On-chain `GatedSwap` event firing** — covered by Phase 2's first live
  broadcast (tx `0x3744af39…3b33a2`). Not re-broadcast here.

## Reliability notes

The synthesis resolver is currently flake-prone under the parallel ENS
queries it issues per profile (TRU-75) and the live oracle additionally
inherits the read-replica lag for ENS text records (TRU-76, expanded to
note oracle exposure). Symptoms observed during this test run:

1. `address: null` for `kernel.emilemarcelagustin.eth` even though the
   address record is set.
2. Intermittent `tier=none` for an otherwise verified profile.
3. RiskPolicy text-record fetch returning empty for a freshly published
   policy.

The runner retries (`MAX_ATTEMPTS=6`) on each known flake signature plus on
"200 with a suspiciously low recipientTier" (which catches the policy-no-op
case). Once synthesis cooperates, the oracle's enforcement is correct on
all three branches.

A meaningful next step would be porting the orchestrate-side
`resolveAddress` fallback (when synthesis returns `address: null`) into the
oracle Worker so it doesn't error out on case-A's flake mode. Tracked
under TRU-76.
