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

The corresponding allow-case capture (`allow-<date>.jsonl`) lands once
TRU-88 is fixed: re-run `pnpm provision:daemon --ens-name daemon.trustrust.eth`
+ the (post-synthesis-#1-fix) `ensemble agent register`, then `scripts/
redeploy-daemon-trustrust.sh`. Same daemon-1 binary; the only thing that
changes is the on-chain manifest signature.
