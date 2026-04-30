# `infra/openclaw-skill/`

OpenClaw skill that lets the bot edit the TrustSwap autonomous daemon's
operating policy in natural language. The skill itself
(`trust-swap-policy.md`) is a self-contained markdown file the bot
consumes; the install script (`install.sh`) wires it into OpenClaw on
the droplet and grants the openclaw user write access to
`/srv/trust-swap/policy.json`.

| File | Purpose |
|---|---|
| `trust-swap-policy.md` | The skill — schema, when-to-use, atomic-write pattern, worked examples (TRU-82) |
| `install.sh` | Idempotent installer: joins openclaw user to `trust-swap-policy` group, symlinks the skill into `~openclaw/.openclaw/skills/` (TRU-83) |

## Install order on the droplet

1. **Daemon-side first** — `sudo /opt/trust-swap/infra/droplet/install.sh`
   creates the `trust-swap-policy` group, the `trust-swap` system user,
   and `/srv/trust-swap/` (mode 2775, setgid so atomic renames inherit
   the group).

2. **OpenClaw-side second** — `sudo /opt/trust-swap/infra/openclaw-skill/install.sh`
   joins the `openclaw` user to `trust-swap-policy` and links the skill
   into `~openclaw/.openclaw/skills/`.

3. **Restart OpenClaw** — `sudo systemctl restart openclaw-gateway`
   (or `openclaw node restart`). Without this the openclaw process
   has the pre-install group cache and will get `Permission denied`
   on writes.

## Why a symlink, not a copy

`/opt/trust-swap/` is a deployed checkout of this repo. Any time we
update the skill (better examples, schema changes), `git pull` (or
re-rsync) on `/opt/trust-swap/` updates the source file, and the
symlink at `~openclaw/.openclaw/skills/trust-swap-policy.md` picks it
up on the next OpenClaw reload — no second deploy step.

## Why a separate installer (vs. baking into infra/droplet/install.sh)

The daemon and OpenClaw are independently deployable. A droplet that
only hosts the daemon shouldn't fail because openclaw isn't installed;
a droplet that has openclaw under a non-default username
(`OPENCLAW_USER=clawbot`) should still work without forking the daemon
installer.

## Overrides

| Env var | Default | Why you'd change it |
|---|---|---|
| `OPENCLAW_USER` | `openclaw` | Custom username for the OpenClaw service |
| `OPENCLAW_SKILLS_DIR` | `~$OPENCLAW_USER/.openclaw/skills` | Non-default skills location (e.g. system-wide install at `/usr/share/openclaw/skills`) |

## Verification after install

```bash
# 1) Group membership applied?
id openclaw | grep trust-swap-policy

# 2) Skill is visible to openclaw?
sudo -u openclaw ls -la ~/.openclaw/skills/trust-swap-policy.md

# 3) End-to-end write smoke (run after openclaw restart)
sudo -u openclaw bash -c '
  cp /srv/trust-swap/policy.json /tmp/policy.json
  cp /tmp/policy.json /srv/trust-swap/policy.json.tmp
  mv /srv/trust-swap/policy.json.tmp /srv/trust-swap/policy.json
'
# Silent success = wired up. "Permission denied" = openclaw process
# still on pre-install group cache; restart it.

# 4) Daemon picks up the rename?
sudo journalctl -u trust-swap-agent -n 5 -o cat
# Look for tick.start with a fresh policyHash within schedule.intervalSec
```

## Uninstall

```bash
# Remove openclaw from the group
sudo gpasswd -d openclaw trust-swap-policy

# Remove the symlink
sudo rm ~openclaw/.openclaw/skills/trust-swap-policy.md

# Restart openclaw to drop the group cache
sudo systemctl restart openclaw-gateway
```

The daemon-side files (group, /srv/trust-swap, policy.json) are owned
by `infra/droplet/uninstall.sh` — different scope.
