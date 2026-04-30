# `infra/identities/`

Public record of every TrustSwap on-chain identity. Committed; secrets are
not — all encrypted keystores live under `~/.synthesis/`.

| File | Identity | Provisioned by |
|---|---|---|
| `daemon.json` | `daemon.emilemarcelagustin.eth` — Phase 5 autonomous agent | `pnpm provision:daemon` |

Each record captures: ENS name, kernel address, owner address, session-key
signer + expiry, RiskPolicy summary, and the tx hashes that set the records
on-chain. Update by re-running the corresponding provisioning script (each
is resumable + idempotent).
