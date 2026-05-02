# Phase 6c — A2A peer-fulfillment demo captures

Each `*.jsonl` file is one daemon-1 tick worth of `tru agent run` JSONL events,
filtered to the agent.* / tick.* / peer.* lines that prove a single
peer-fulfillment outcome end-to-end (discovery → evaluation → settlement).

## Files

### `deny-2026-05-02.jsonl`

First-ever captured `peer.intent-settled` event, captured immediately after
the TRU-87 peer-poll-hoist fix landed (PR #20, merge `0c9c034`). The settle
attempt was denied at the on-chain RiskPolicy gate because
`daemon.trustrust.eth`'s synthesis manifest lineage is broken (TRU-88,
caused by the synthesis ENSIP-25 key-format mismatch upstream — see the
project memory `project_tru88_audit.md`).

What this proves:

1. **TRU-87 fix is live in production.** Iter 1 of the new daemon binary
   fired peer-poll cleanly. Pre-fix, this would have been blocked by the
   `lastSwapAt` lockout.
2. **The bidirectional gate works.** The deny reason —
   `recipient's manifest lineage chain has a broken signature — an earlier
   version was signed by a different key.` — comes from the oracle's TRL
   layer evaluating daemon-2's manifest, exactly the surface the demo plan
   wanted to exercise.
3. **Combined-throughput constraints hold.** The follow-up `tick.skipped`
   (reason `min-seconds-between-swaps`) shows the regular tick correctly
   yielded after the peer attempt — peer-poll won the slot, regular tick
   bounced off `applyConstraints` per the TRU-87 design.

### `allow-2026-05-02.jsonl`

The matching allow-case capture, recorded after TRU-88 was fully unblocked.
Daemon-1 (`daemon.emilemarcelagustin.eth`) peer-fulfilled daemon-2's
`drip-usdc-to-weth` intent: 0.1 USDC swapped to WETH and delivered to
`daemon.trustrust.eth`. Settlement tx on Base:
[`0xfe6f2308…23a88f5`](https://basescan.org/tx/0xfe6f2308701fc19074fa84304efcb6dbd5e4cb14e06d91e91028e471a23a88f5).

Five gates that had to pass for `decision: allow` (vs the deny capture's failure on the first one):

1. **Manifest lineage intact** — daemon.trustrust.eth published an AIP V2 Mode B
   manifest (`agent-version-lineage = list:v1 ipfs://…`) signed by the
   registry owner. Resolver walked `prev: null` → genesis → intact.
2. **Manifest signature valid** — daemon.trustrust.eth's `addr()` was repointed
   from the kernel to the owner EOA so `verifyMessage` recovers correctly.
   (Upstream issue: synthesis #41 — resolver checks `addr()` instead of the
   registry owner.)
3. **Recipient accepts `tokenIn`** — daemon-2's RiskPolicy `acceptedTokens`
   includes USDC.
4. **Swapper accepts `tokenOut`** — daemon-1's RiskPolicy was extended with
   WETH so the bidirectional check on `tokenInbound` (= `tokenOut` for the
   swapper side) passes.
5. **Tier + size checks** — both daemons at tier `registered`+, swap value
   well under both `maxAcceptedSize` caps.

Reproducing this involves: a published AIP manifest for daemon.trustrust.eth,
the addr() pointing at the manifest signer, both daemons' RiskPolicy
`acceptedTokens` covering both legs of the swap, and waiting for ENS
finalization (`blockTag: finalized`) before the oracle re-resolves.
