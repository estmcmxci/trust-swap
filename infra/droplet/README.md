# TrustSwap daemon — droplet deploy

Deploys `tru agent run` (TRU-38) to the existing DigitalOcean droplet
(`159.65.249.29`, Tailscale `100.121.243.97`). One systemd unit,
crash-loop-guarded, autonomously settling swaps inside the bounds of
the policy at `/srv/trust-swap/policy.json` against the
TrustSwapRouter (`0x4aFa…BD3a`) on Base mainnet.

## Layout on the droplet

| Path | Owner | Mode | Contents |
|---|---|---|---|
| `/opt/trust-swap/cli` | root | 0755 | Deployed CLI artifact (`pnpm deploy` output) |
| `/etc/trust-swap/agent.env` | trust-swap | 0600 | Bundler URL, API keys, status-bind IP |
| `/var/lib/trust-swap/.synthesis/daemon-session-key.json` | trust-swap | 0600 | Session-key signer + serialized account |
| `/srv/trust-swap/policy.json` | trust-swap:trust-swap-policy | 0664 (in 2775 dir) | Live Operating Policy |
| `/etc/systemd/system/trust-swap-agent.service` | root | 0644 | systemd unit |

## One-time provision (local)

Before the first deploy, run the provisioning ceremony on the local
machine — registers the daemon's ENS subname, kernel, RiskPolicy, and
session key. See `scripts/provision-daemon.ts`:

```
pnpm provision:daemon
```

Outputs `~/.synthesis/daemon-session-key.json` (the file we ship to the
droplet) and `infra/identities/daemon.json` (committed, public-only).

## Deploy procedure

Tailscale must be up on the local machine and the droplet must be
reachable on `100.121.243.97`. SSH config example:

```
# ~/.ssh/config
Host trust-swap-droplet
  HostName 100.121.243.97
  User root
```

### 1. Build the deployable CLI

```
pnpm --filter @trust-swap/cli build
pnpm deploy --filter @trust-swap/cli ./out/cli
```

`./out/cli/` is now a self-contained pnpm-deploy bundle (dist + the
exact `node_modules` it needs).

### 2. rsync the bundle + infra dir

```
rsync -avz --delete \
  ./out/cli/                         trust-swap-droplet:/opt/trust-swap/cli/
rsync -avz --delete \
  ./infra/droplet/                   trust-swap-droplet:/opt/trust-swap/infra/droplet/
```

### 3. Install service (idempotent)

```
ssh trust-swap-droplet sudo /opt/trust-swap/infra/droplet/install.sh
```

First run creates the `trust-swap` system user, the
`trust-swap-policy` group, and seeds `/etc/trust-swap/agent.env` and
`/srv/trust-swap/policy.json` from sample fixtures. Re-runs are safe.

To install a parallel daemon (e.g. the second listen-mode agent at
`daemon.trustrust.eth`, TRU-42), pass `--instance <slug>`:

```
ssh trust-swap-droplet sudo /opt/trust-swap/infra/droplet/install.sh --instance trustrust
```

Each instance gets its own systemd unit (`trust-swap-agent-<slug>.service`),
env file (`/etc/trust-swap/agent-<slug>.env`), and policy
(`/srv/trust-swap/policy-<slug>.json`). The shared user, group, and
`$HOME_DIR` are reused. Steps 4–7 below repeat per instance, swapping in
the suffixed paths.

### 4. Place the daemon session-key file

`scp` (or `rsync`) the locally-issued session-key file:

```
scp ~/.synthesis/daemon-session-key.json \
    trust-swap-droplet:/var/lib/trust-swap/.synthesis/daemon-session-key.json
ssh trust-swap-droplet sudo chown trust-swap:trust-swap \
    /var/lib/trust-swap/.synthesis/daemon-session-key.json
ssh trust-swap-droplet sudo chmod 600 \
    /var/lib/trust-swap/.synthesis/daemon-session-key.json
```

### 5. Edit agent.env

```
ssh trust-swap-droplet sudo -u trust-swap \
    EDITOR=nano sudo -e /etc/trust-swap/agent.env
```

Fill in `BUNDLER_URL_BASE`, `ORACLE_URL`, `UNISWAP_API_KEY`. Confirm
`TRU_AGENT_STATUS_BIND` matches the droplet's Tailscale IP.

### 6. Review the live policy

The installer dropped the sample fixture at `/srv/trust-swap/policy.json`.
Edit before enabling — the daemon will start swapping inside whatever
`intents` block is there.

```
ssh trust-swap-droplet sudo -e /srv/trust-swap/policy.json
```

### 7. Enable + verify

```
ssh trust-swap-droplet sudo systemctl enable --now trust-swap-agent
ssh trust-swap-droplet journalctl -u trust-swap-agent -f
```

Expect to see `agent.start` JSONL within a second, then `tick.start`
and either `tick.swap` or `tick.skipped` per `schedule.intervalSec`.

Status endpoint:

```
curl http://100.121.243.97:18790/healthz   # → ok
curl http://100.121.243.97:18790/events    # last 100 events as JSON
curl http://100.121.243.97:18790/intents   # 404 unless policy.listen is set (Phase 6c)
```

### A2A discovery (Phase 6c, optional)

The daemon advertises its discovery endpoint via the ENSIP-26
`agent-endpoint` ENS text record. **This is a base URL** — the same
record is consumed by `@trust-swap/core`'s RiskPolicy resolver
(`<endpoint>/policy`) and by the A2A peer poll
(`<endpoint>/intents`). Set it without a path component, e.g.
`http://100.121.243.97:18790`, and the consumers append the right
sub-path. The repo's `scripts/set-agent-endpoint.ts` writes whatever
URL you pass it.

To turn on the peer-poll loop on a daemon, add a `listen` block to its
operating policy and restart:

```json
"listen": {
  "peers": ["daemon.trustrust.eth"],
  "pollIntervalSec": 30,
  "maxConcurrentIntents": 2
}
```

Each tick where `pollIntervalSec` has elapsed, the daemon resolves each
peer's `agent-endpoint` ENS record, fetches `/intents`, and emits a
`peer.poll` event followed by one `peer.intent-evaluated` per advertised
intent (`decision: "match" | "decline"`). For `match` decisions the
daemon re-checks the same per-tick constraints
(`minSecondsBetweenSwaps`, daily spend cap, halt) and emits one of:

- `peer.intent-settled` — `orchestrate` returned. `decision: "allow"`
  with a `txHash` is a successful broadcast; `decision: "deny"` is a
  real oracle/policy refusal.
- `peer.intent-skipped` — constraints blocked the settlement attempt
  (mirrors `tick.skipped`'s `ConstraintBlockReason`).
- `peer.intent-error` — settlement threw before `orchestrate` returned
  (token parse, ENS lookup, RPC outage). Mirrors `tick.error` so an
  audit tool can filter infrastructure failures from policy denials
  by event type alone.

The bidirectional RiskPolicy gate is enforced at oracle-attestation
time, so a swap that would deliver to a peer below this daemon's
`minCounterpartyTier` is rejected before it broadcasts.

Settlement updates the same state the regular intent path uses, so
combined throughput respects `minSecondsBetweenSwaps` — typically one
swap per tick across both sources. Tail the JSONL to confirm:

```
journalctl -u trust-swap-agent -f | jq 'select(.type | startswith("peer."))'
```

## Operations

| Task | Command |
|---|---|
| Reload policy edits | No-op — daemon re-reads on each tick |
| Restart after env edit | `sudo systemctl restart trust-swap-agent` |
| Tail logs | `journalctl -u trust-swap-agent -f` |
| Stop | `sudo systemctl stop trust-swap-agent` (graceful — emits `agent.shutdown`) |
| Disable + remove | `sudo /opt/trust-swap/infra/droplet/uninstall.sh` |
| Hot-redeploy CLI | rsync `./out/cli/` over `/opt/trust-swap/cli/`, then `sudo systemctl restart trust-swap-agent` |

## Crash-loop guard

`StartLimitIntervalSec=300` + `StartLimitBurst=5` — if the unit fails
five times within 5 minutes, systemd stops trying. After diagnosing
the underlying cause:

```
sudo systemctl reset-failed trust-swap-agent
sudo systemctl start trust-swap-agent
```

## Memory ceiling

`MemoryMax=320M`. The daemon's working set is tiny (Node + viem +
ZeroDev SDK ≈ 150–200 MB resident); the cap is a tripwire for memory
leaks rather than a tuned number.
