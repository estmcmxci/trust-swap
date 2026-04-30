# OpenClaw exposure hardening — droplet runbook

Operational checklist for the OpenClaw service on the droplet
(`159.65.249.29`, Tailscale `100.121.243.97`). OpenClaw owns its own
config; nothing in this repo writes it. This runbook tells you what to
change, why, and how to verify.

> **Scope.** Local-machine OpenClaw is fine — `openclaw security audit`
> on the laptop reports clean. The three concerns below are
> **droplet-only**, where the gateway is reachable from the public IP.

## What we're hardening

| Concern | Risk | Fix |
|---|---|---|
| Gateway binds `0.0.0.0:18789` | Anyone with the droplet's public IP can connect to the WebSocket gateway and probe auth | Bind to Tailscale only — `gateway.bind = "tailnet"` and `gateway.host = 100.121.243.97` |
| `dangerouslyAllowHostHeaderOriginFallback = true` (in older configs / OPENCLAW_DANGEROUSLY_ALLOW_HOST_HEADER_ORIGIN_FALLBACK env) | Origin-header gating can be bypassed by a forged Host header | Remove the flag entirely, or set to `false` |
| Auth has no rate limit | Brute-force the password / token without lockout | Front the gateway with a reverse proxy that rate-limits, OR use `gateway.auth = "trusted-proxy"` + a hardened nginx in front |

## 1) Bind to Tailscale only

### Verify current state

SSH to the droplet, then:

```bash
# What's bound on 18789 right now?
sudo ss -tlnp | grep 18789

# What does OpenClaw think its config is?
openclaw config get gateway.bind
openclaw config get gateway.host
openclaw config get gateway.port
```

If `ss` shows `0.0.0.0:18789` (or `*:18789`), the gateway is listening on
all interfaces. We want it bound to the Tailscale interface only.

### Apply

OpenClaw's config file lives at `~/.openclaw/node.json` (or wherever
`OPENCLAW_CONFIG_PATH` points if you set it). Either edit it directly:

```jsonc
{
  "version": 1,
  "gateway": {
    "host": "100.121.243.97",   // droplet's Tailscale IP
    "port": 18789,
    "tls": false,
    "bind": "tailnet"           // not "lan", not "auto", not "custom" (unless you know what you're doing)
  }
}
```

…or use the CLI helpers:

```bash
openclaw config set gateway.bind tailnet
openclaw config set gateway.host 100.121.243.97
openclaw config validate
```

### Restart

```bash
# If running under systemd:
sudo systemctl restart openclaw-gateway

# Or if running via openclaw node (launchd-style installer):
openclaw node restart
```

### Verify

```bash
# Listener should now show 100.121.243.97:18789, NOT 0.0.0.0:18789
sudo ss -tlnp | grep 18789

# Curl from outside the Tailnet (e.g. a phone on cellular hitting the
# droplet's public IP) — should refuse the connection
curl -sv http://159.65.249.29:18789/health  # connection refused / timeout

# Curl from inside the Tailnet — should succeed
curl -sv http://100.121.243.97:18789/health
```

## 2) Drop the host-header origin-fallback flag

### Verify

```bash
# Look in env-file (most common landing place for the dangerously-* flag)
sudo grep -i 'DANGEROUSLY_ALLOW_HOST_HEADER_ORIGIN_FALLBACK\|dangerouslyAllowHostHeaderOriginFallback' \
     /etc/systemd/system/openclaw*.service \
     /etc/openclaw/*.env \
     ~/.openclaw/*.json 2>/dev/null

# And in the live process environment
sudo cat /proc/$(pgrep -f openclaw | head -1)/environ | tr '\0' '\n' | grep -i origin
```

### Apply

If you find the env var or the JSON flag, **remove it** (don't just set
to `false` — leaving it in the config is a footgun for the next operator
who flips it without thinking). Then restart.

If your reverse-proxy setup actually requires origin-fallback (rare —
most modern proxies forward `Origin` correctly), prefer the explicit
`gateway.trustedProxies` allow-list:

```bash
openclaw config set gateway.trustedProxies '["10.0.0.5","10.0.0.6"]'
```

…then leave origin-fallback off.

### Verify

After restart, `openclaw security audit` should return **0 critical, 0
warn** on the host-header dimension. If you see
`gateway.trusted_proxies_missing` it's because you have `bind=loopback`
and a proxy somewhere; either accept the warning (loopback-only is
already safe) or set the trustedProxies list.

## 3) Add an auth rate limit

OpenClaw's gateway has built-in token / password auth (`gateway.auth =
"token" | "password" | "trusted-proxy" | "none"`) but no built-in
per-IP rate limit. Two options:

### Option A — front with nginx (recommended)

Add a small nginx config on the droplet that:

- Listens on the Tailscale interface
- Rate-limits `/auth` paths (or whatever path the gateway uses for auth
  handshake) to e.g. 5 req / min per IP via `limit_req_zone`
- Forwards everything else to `127.0.0.1:18789`
- Sets `gateway.bind = "loopback"` on OpenClaw's side (since nginx now
  handles network exposure) and switches `gateway.auth = "trusted-proxy"`
  with the nginx IP in `gateway.trustedProxies`

Sample `/etc/nginx/sites-available/openclaw`:

```nginx
limit_req_zone $binary_remote_addr zone=openclaw_auth:10m rate=5r/m;

server {
  listen 100.121.243.97:18789;
  server_name _;

  location / {
    # Auth-handshake paths: rate-limited
    location ~ ^/(auth|login|pair)/ {
      limit_req zone=openclaw_auth burst=2 nodelay;
      proxy_pass http://127.0.0.1:18789;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_set_header X-Forwarded-For $remote_addr;
    }

    # Everything else: pass through
    proxy_pass http://127.0.0.1:18789;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Forwarded-For $remote_addr;
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/openclaw /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Then on the OpenClaw side:

```bash
openclaw config set gateway.bind loopback
openclaw config set gateway.host 127.0.0.1
openclaw config set gateway.auth trusted-proxy
openclaw config set gateway.trustedProxies '["127.0.0.1"]'
sudo systemctl restart openclaw-gateway
```

### Option B — fail2ban on the gateway log

Cheaper but coarser. Drop a fail2ban jail that watches OpenClaw's
gateway log for repeated auth failures and bans the source IP for 1
hour:

```ini
# /etc/fail2ban/jail.d/openclaw.conf
[openclaw-auth]
enabled = true
filter  = openclaw-auth
logpath = /var/log/openclaw/gateway.log
maxretry = 5
findtime = 300
bantime  = 3600
```

```ini
# /etc/fail2ban/filter.d/openclaw-auth.conf
[Definition]
failregex = ^.*auth.*failed.*ip=<HOST>.*$
ignoreregex =
```

Tune `failregex` to match the actual log line shape from your OpenClaw
version (`grep auth /var/log/openclaw/gateway.log` first to confirm).

```bash
sudo systemctl restart fail2ban
sudo fail2ban-client status openclaw-auth
```

## Final verification

Run all four checks; all should be green:

```bash
# 1) Gateway is Tailscale-only
sudo ss -tlnp | grep 18789                # → 100.121.243.97:18789 only
curl -sv http://159.65.249.29:18789/health 2>&1 | head -3   # → refused

# 2) No origin-fallback flag in any config or env
sudo grep -ri 'dangerouslyAllowHostHeaderOriginFallback\|DANGEROUSLY_ALLOW_HOST_HEADER_ORIGIN_FALLBACK' \
     /etc/openclaw /etc/systemd ~/.openclaw 2>/dev/null   # → no output

# 3) OpenClaw security audit clean
openclaw security audit                   # → 0 critical, 0 warn

# 4) Rate-limit smoke (nginx path)
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -sw '%{http_code}\n' -o /dev/null http://100.121.243.97:18789/auth/login
done                                       # → mostly 200/401, a few 429 after burst
```

## Rollback

If anything breaks, the easiest rollback is to restore `~/.openclaw/node.json`
from `~/.openclaw/node.json.bak` (make a backup before editing) and
`systemctl restart openclaw-gateway`. The nginx layer can be removed
by `rm /etc/nginx/sites-enabled/openclaw && sudo systemctl reload nginx`.

## Reference

- OpenClaw security audit: `openclaw security audit --deep --json`
- Config CLI: `openclaw config --help`
- Gateway CLI: `openclaw gateway --help`
- Trust-swap daemon's own status endpoint is bound separately to
  `100.121.243.97:18790` via `TRU_AGENT_STATUS_BIND` — see
  `infra/droplet/agent.env.example` and `infra/droplet/README.md`.
