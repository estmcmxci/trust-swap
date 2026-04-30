---
name: trust-swap-policy
description: Read and edit the TrustSwap autonomous daemon's operating policy. Use when the user wants to change which swaps the daemon performs, its schedule, or its safety constraints — e.g. "halve the schedule", "swap a different token next", "stop swapping today", "raise the daily cap to $50". Writes are validated against the schema before they land; the daemon picks up changes on its next tick.
version: 1.0.0
tags: [trust-swap, daemon, autonomous-agent, policy-editor]
---

# Trust-swap operating-policy editor

I edit the operating policy that drives the TrustSwap autonomous daemon
on the droplet. The daemon (`tru agent run`) re-reads this file on every
tick (default every 300s), so any valid edit takes effect within one
cycle — no SIGHUP or restart needed.

## When to use

Trigger this skill when the user asks to:

- Change which swaps the daemon does ("trade WETH for DAI instead of USDC")
- Adjust the schedule ("only run between 9am and 5pm UTC", "every minute")
- Tighten or loosen safety constraints ("raise the daily cap to $50",
  "let it fail 5 times before halting")
- Pause or resume specific intents ("stop the WETH-USDC trade for now")
- Add, remove, or rename intents
- Read the current state ("what's the daemon doing right now?")

Do NOT use this skill for:

- Editing the agent's identity (kernel address, ENS, session-key path) —
  those are set once by `pnpm provision:daemon` and changing them
  here without re-issuing keys orphans funds.
- Changing the deployed router address — that's an env var, not a policy
  field, and the session key is on-chain pinned to a specific router.

## File location

```
/srv/trust-swap/policy.json
```

Mode `0664`, owner `trust-swap`, group `trust-swap-policy`. The OpenClaw
service user is in `trust-swap-policy` so it can read + write atomically.

## Schema (ALL writes MUST validate against this)

```jsonc
{
  "version": 1,                                    // literal 1
  "agent": {
    "ensName": "daemon.emilemarcelagustin.eth",    // ENS name (string, ≥1 char)
    "kernelAddress": "0x522D9d15…",                // 0x-prefixed 20-byte address
    "sessionKeyPath": "~/.synthesis/daemon-session-key.json"
  },
  "schedule": {
    "intervalSec": 300,                            // integer > 0 (tick cadence)
    "startAt": "2026-04-30T09:00:00Z",             // OPTIONAL ISO-8601 with offset
    "endAt":   "2026-04-30T17:00:00Z"              // OPTIONAL; must be > startAt
  },
  "intents": [
    {
      "id": "drip-weth-to-usdc",                   // unique within policy
      "kind": "swap",                              // literal "swap"
      "tokenIn":  "WETH",                          // symbol OR 0x address
      "tokenOut": "USDC",                          // symbol OR 0x address
      "amount":   "0.0005",                        // decimal string (no scientific notation)
      "recipient": "kernel.emilemarcelagustin.eth", // ENS name OR 0x address
      "cron": "*/5 * * * *",                       // OPTIONAL per-intent cadence
      "enabled": true                              // boolean
    }
  ],
  "constraints": {
    "maxDailySpendUsd": 25,                        // number ≥ 0
    "minSecondsBetweenSwaps": 60,                  // integer ≥ 0
    "haltOnConsecutiveFailures": 3                 // integer > 0 (must be > 0)
  },
  "listen": {                                      // OPTIONAL — Phase 6 only
    "peers": ["agent-b.estmcmxci.eth"],
    "pollIntervalSec": 30,
    "maxConcurrentIntents": 2
  }
}
```

### Hard constraints

The on-disk parser is **strict** — any of these will cause the daemon to
reject the policy on its next tick (it keeps running on the previous
valid one and emits `tick.error` JSONL until you fix the file):

- Top-level fields outside the schema → rejected (no extra keys allowed)
- `version` not literal `1`
- `kernelAddress` not a valid 0x-prefixed 20-byte address
- `intervalSec ≤ 0` or non-integer
- `endAt ≤ startAt`
- `amount` matching `\d+(\.\d+)?` only (no `1e6`, no `-5`)
- `recipient` neither a 0x address nor an ENS name (must contain `.`)
- Token symbol with non-alphanumeric characters or > 16 chars
- Duplicate intent `id`
- `haltOnConsecutiveFailures = 0` (would never halt — meaningless)
- Negative `maxDailySpendUsd` or `minSecondsBetweenSwaps`
- ISO-8601 timestamps without offset (use `Z` or `±hh:mm`, not bare
  `2026-04-30T09:00:00`)

## How to read the current policy

```bash
cat /srv/trust-swap/policy.json
```

Always read first, even for "small" edits — the user may have made
changes since your last edit, and overwriting their state is irrecoverable
without git diffing the prior committed sample.

## How to write a policy edit (atomic)

The daemon reads via `fs.watch` on the parent directory and is sensitive
to in-place writes that briefly truncate the file. **Always use the
write-tmp-then-rename pattern** so the daemon never sees a half-written
file:

```bash
# 1) Write the new policy to a tmp file in the same directory
cat > /srv/trust-swap/policy.json.tmp <<'EOF'
{
  "version": 1,
  "agent": { ... },
  ...
}
EOF

# 2) Atomic rename — appears as a single inode swap to the watcher
mv /srv/trust-swap/policy.json.tmp /srv/trust-swap/policy.json
```

Or in one step with `install`:

```bash
install -m 0664 -g trust-swap-policy <(echo '{...new policy json...}') \
        /srv/trust-swap/policy.json
```

The `mv`/`rename` step is what makes it atomic — the daemon's next tick
reads either the old file or the new file, never a partial one.

### Pre-write validation

Before the rename, **always** sanity-check:

1. **JSON syntax** — `jq . /srv/trust-swap/policy.json.tmp` (exits non-zero
   on malformed JSON; abort before renaming).
2. **All required fields present** — version, agent, schedule, intents,
   constraints. The `listen` block is the only optional top-level.
3. **Intent ids are unique** — duplicates fail at parse time.
4. **Round-trip the diff in your head** — what changed, why, and is the
   user's intent reflected? Read the full file back and explain it to
   the user before renaming if any doubt.

If any check fails, **delete the tmp file** instead of renaming:

```bash
rm /srv/trust-swap/policy.json.tmp
```

## Verifying the daemon picked up the change

Tail the daemon's JSONL log:

```bash
ssh <droplet> sudo journalctl -u trust-swap-agent -f -o cat
```

Within `schedule.intervalSec` after the rename, you should see the
`tick.start` event with a fresh `policyHash` (different from the one
before your edit) — that confirms re-read happened. If you see
`tick.error` with `(policy-reload)` in the `intentId`, the new policy
failed validation; the daemon kept running on the old one.

Or via the status endpoint:

```bash
curl http://100.121.243.97:18790/events | jq '.events[-3:]'
```

## Worked examples

### Example 1 — "halve the schedule"

User: *halve the daemon's tick rate*

Read first:
```bash
$ cat /srv/trust-swap/policy.json | jq .schedule
{
  "intervalSec": 300
}
```

Edit:
```bash
cat > /srv/trust-swap/policy.json.tmp <<'EOF'
{ /* full policy with schedule.intervalSec: 150 */ }
EOF
mv /srv/trust-swap/policy.json.tmp /srv/trust-swap/policy.json
```

Confirm: "Schedule halved to 150s. Next tick will pick up within 300s."

### Example 2 — "stop the WETH-USDC trade for now"

Read, find the intent with that token pair, set `enabled: false`. Don't
delete it — disabled intents are easier to re-enable than re-author.

### Example 3 — "raise the daily cap to $50"

Read, change `constraints.maxDailySpendUsd` from current value to `50`.
Confirm to user: "Daily cap raised from $25 → $50. Daemon will adopt on
next tick."

### Example 4 — "add a USDC → DAI trade, $5 each, every 10 min"

Read existing intents to ensure unique `id`. Append:

```jsonc
{
  "id": "usdc-dai-drip",
  "kind": "swap",
  "tokenIn": "USDC",
  "tokenOut": "DAI",
  "amount": "5",
  "recipient": "kernel.emilemarcelagustin.eth",
  "cron": "*/10 * * * *",
  "enabled": true
}
```

## Failure modes

| Symptom | Cause | Recovery |
|---|---|---|
| Edit doesn't take effect after `intervalSec` | Daemon never re-read — most likely the file was edited in-place (not atomic-rename) and the watcher fired but `loadOperatingPolicyFromDisk` saw a truncated file mid-write | Re-do the edit using `mv` from `.tmp` |
| `tick.error` with `(policy-reload)` in JSONL | New policy fails Zod validation | Read the JSONL `message` field — it lists every failed field; fix and re-rename |
| Permission denied on write | OpenClaw user not in `trust-swap-policy` group, or dir is missing setgid bit | `sudo gpasswd -a openclaw trust-swap-policy && sudo chmod 2775 /srv/trust-swap` |
| File appears empty after edit | Tmp file wasn't fsync'd before rename on a crashed host | Rare; reboot recovery — restore from `infra/droplet/sample-operating-policy.json` and re-author |

## Reference

- Schema source of truth: `packages/core/src/operating-policy.ts`
  (Zod schema; this skill mirrors it but the daemon validates against
  the live one)
- Daemon command: `packages/cli/src/commands/agent.ts`
- Sample fixture: `infra/droplet/sample-operating-policy.json`
- Deploy procedure: `infra/droplet/README.md`
