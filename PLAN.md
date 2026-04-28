# TrustSwap — Trust-Gated Settlement on Uniswap

A reference implementation of the gate-then-execute pattern: every Uniswap swap is gated by a TRL resolution of the counterparty, signed by a policy-bound agent wallet, and settled through the Uniswap Trading API. Targets the OpenAgents ENS "Best Integration for AI Agents" prize and the Uniswap Foundation "Best API Integration" prize from one codebase.

TrustSwap is an **application built on TRL**, not a feature of Ensemble itself. It lives in a separate repo (`estmcmxci/trust-swap`) and consumes the TRL primitives (`gate()`, `Signer`) from `@synthesis/resolver` as a library dependency. See `Depends on` below.

## Depends on

This plan assumes the TRL Policy + Signers PR has landed in synthesis. That PR (`plans/trl-policy-and-signers.md`) ships the generic primitives this app composes on top of:

| Symbol | From | Used here for |
|---|---|---|
| `gate(profile, policy) → GateDecision` | `@synthesis/resolver` | the trust gate before every swap |
| `TrustPolicy`, `GateDecision` types | `@synthesis/resolver` | server-action and CLI input shapes |
| `Signer` interface, `Batch` type | `@synthesis/resolver` | uniform signing across local + Namera |
| `createLocalSigner({ privateKey, … })` | `@synthesis/resolver` | early-dev fallback |
| `createNameraSigner({ keystorePath, sessionKeyPath, bundlerUrl, … })` | `@synthesis/resolver` | the production signer for the daemon |
| `resolve(ensName)`, `TrustProfile` | `@synthesis/resolver` (existing) | resolves the recipient before gating |
| `ensemble gate <ens>` CLI | `@synthesis/cli` | shell-driven inspection during development |

If any of these symbols don't exist when TrustSwap Phase 0 starts, that's a blocker — finish the synthesis PR first.

The substrate audit (live ENS reads in `layers/identity.ts`, manifest signature verification in `layers/manifest.ts`) is also a synthesis concern, not a TrustSwap concern. It should happen as part of the TRL Policy + Signers PR review, not here.

## Positioning

One-line pitch: **swap with people you can prove are who they claim to be.**

The novel primitive is *trust-gated settlement* — a Uniswap swap that doesn't execute unless the counterparty resolves through TRL at or above a configurable trust tier, with a valid manifest signature and unbroken AIP lineage. The same primitive runs as a CLI command, a web page, an MCP tool, and a long-lived agent daemon on a remote VM.

Three named primitives compose, each doing one job:

| Layer | Provider | Job |
|---|---|---|
| Identity / semantic policy | `@synthesis/resolver` (TRL) | "Is the counterparty who they claim to be, at the tier I require?" |
| Wallet / imperative policy | `@namera-ai/sdk` over ZeroDev kernel accounts | "Can this session key call this target, with these args, within these gas / rate / time bounds?" |
| Settlement | Uniswap Trading API | "Quote and execute the swap." |

Neither identity nor wallet policy alone is sufficient. Namera enforces *call shape* (target, function, argument conditions, value, gas, rate, time); TRL enforces *meaning* (is this counterparty real, current, and trusted); Uniswap moves the value. Both gates must agree before any user op broadcasts.

Namera is open-source, Apache-2.0, local-first — there is no managed service, no API key, no third-party uptime dependency at the wallet layer. Owner keys live in encrypted local keystores; session keys are issued client-side; policies install lazily into a ZeroDev kernel account on first use. The only runtime dependency Namera introduces is an ERC-4337 bundler (Pimlico, Alchemy, or self-hosted) — that's the same dep any account-abstraction stack carries.

## Why this hits both prize tracks

### ENS — Best Integration for AI Agents ($2,500 / $750 / $500)

Verbatim prize prompt: *"resolving the agent's address, storing its metadata, gating access, enabling discovery, or coordinating agent-to-agent interaction."*

| Prompt clause | TrustSwap satisfaction |
|---|---|
| Resolving the agent's address | `viem.getEnsAddress` on the recipient ENS name, every swap |
| Storing metadata | Optional `last-trust-snapshot` text record cached on the agent's own ENS |
| Gating access | The trust tier check *is* the gate — no swap without it |
| Enabling discovery | `/swap` page resolves and renders the recipient's full TRL profile inline |
| Coordinating agent-to-agent | Two agents on droplets with mutual TRL gates (stretch) |


### Uniswap Foundation — Best API Integration ($2,500 / $1,500 / $1,000)

Verbatim prize prompt: *"Agents that trade, coordinate with other agents, or invent primitives we haven't imagined yet."*

| Prompt axis | TrustSwap satisfaction |
|---|---|
| Real onchain execution | Canonical 3-step flow: `/check_approval → /quote → /swap`, signed by a Namera session key, broadcast to Base mainnet |
| Agentic context | Long-lived daemon on a remote VM signs swaps autonomously inside policy bounds |
| Coordinate with other agents | A2A demo: two ENS-named agents resolve each other and settle via mutual TRL approval (stretch) |
| Novel primitive | "Trust-gated settlement" — a composable `resolve → gate → execute` pattern other Trading API consumers can adopt |
| FEEDBACK.md substance | We compose, not just call — the doc surfaces real friction (no native ENS in API inputs, no policy hook surface, quote freshness vs. multi-step pre-flight) |

## System architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   USER / AGENT  ─────────────────────────────────────────────────►  │
│                                                                     │
│   Calls one of three surfaces:                                      │
│     • CLI:     tru swap <ens> --amount <n>                          │
│     • Site:    /swap (Next.js page on trust-swap/packages/site)     │
│     • MCP:     trust-swap-mcp tool "trust_gated_swap"               │
│     • Daemon:  tru agent run (long-lived loop on a VM)              │
│                                                                     │
└────────────────┬────────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   POLICY LAYER (off-chain, semantic)                                │
│                                                                     │
│   resolve(recipientEns) ─►  TrustProfile                            │
│   gate(profile, policy) ─►  { allow: boolean, reason: string }      │
│                                                                     │
│   Policy fields:                                                    │
│     minTier:        TrustTier            // e.g. "verified"         │
│     requireLineage: boolean              // walk AIP prev chain     │
│     requireSig:     boolean              // verify manifest sig     │
│     allowSelf:      boolean              // permit recipient = self │
│                                                                     │
└────────────────┬────────────────────────────────────────────────────┘
                 │ allow
                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   QUOTE LAYER (Uniswap Trading API)                                 │
│                                                                     │
│   POST /check_approval                                              │
│   POST /quote      { swapper, recipient, tokenIn, tokenOut, ... }   │
│   POST /swap       (spread quote response, strip permitData=null)   │
│                                                                     │
└────────────────┬────────────────────────────────────────────────────┘
                 │ signed tx
                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   SIGNING / WALLET LAYER (on-chain, imperative)                     │
│                                                                     │
│   ZeroDev Kernel Account (created via @namera-ai/sdk/account)       │
│      ◄── ECDSA owner key (encrypted keystore, off-droplet)          │
│      │                                                              │
│      ├─ Session Key (ECDSA, serialized + sent to droplet)           │
│      │                                                              │
│      └─ Permission Validator (ZeroDev) enforcing:                   │
│           toCallPolicy:      Universal Router execute() only,       │
│                              with ParamCondition on inputs[]        │
│           toGasPolicy:       allowed = parseEther("0.005")          │
│           toRateLimitPolicy: count = 1, interval = 3600s            │
│           toTimestampPolicy: validUntil = now + 86400               │
│                                                                     │
│   Broadcast via ERC-4337 UserOperation through Pimlico bundler      │
│                                                                     │
└────────────────┬────────────────────────────────────────────────────┘
                 │ broadcast
                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   BASE MAINNET — Universal Router 0x6ff5693b9...d299b43             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Reference reading (clone or skim before coding)

| Repo | Purpose | Path on this machine |
|---|---|---|
| `Uniswap/uniswap-ai` | Agent-readable skill packages — `swap-integration`, `pay-with-any-token`, `v4-sdk-integration`. The canonical "how to integrate Uniswap as an agent" surface. | `~/synthesis-research/uniswap-ai/` |
| `Uniswap/sdks` | Source of `@uniswap/{sdk-core,v2-sdk,v3-sdk,v4-sdk,router-sdk,universal-router-sdk}`. Lower-level fallback if the Trading API breaks. | not yet cloned — clone if Phase 1 needs it |
| `Uniswap/universal-router` | Solidity for the router contract on Base (`0x6ff5693b99212da76ad316178a184ab56d299b43`). Read only if debugging an on-chain revert. | not cloned |
| `Uniswap/uniswapx-service` | Off-chain UniswapX filler/order service. Read if we add UniswapX routing as a stretch. | not cloned |
| `thenamespace/namera` | Wallet layer SDK (`@namera-ai/sdk` over `@zerodev/sdk` + `@zerodev/permissions`). | `~/synthesis-research/namera/` |

`developers.uniswap.org` does not expose `SKILL.md`, `llms.txt`, `llms-full.txt`, or an OpenAPI spec at the gateway URL. The official agent-readable surface is `uniswap-ai` itself. Do not look for a docs-site SKILL.md — it does not exist.

`Uniswap/ai-toolkit` is a separate repo that's easy to confuse with `uniswap-ai`. It is *internal* Uniswap dev tooling (Claude Code slash commands like `/review-pr`, MCP integrations to Linear/Notion/Graphite). Not a build dep for us. Useful only as cultural signal that Uniswap engineers are Claude-Code-pilled.

## Components

### 1. Policy gate (consumed from `@synthesis/resolver`)

The `gate()` primitive ships in synthesis — see `Depends on` above. TrustSwap imports it directly:

```typescript
import { gate, type TrustPolicy, type GateDecision } from "@synthesis/resolver";
```

TrustSwap-specific policy *defaults* (e.g. always `minTier: "verified"`, `requireLineage: true`) live in `packages/core/policy.ts` — a thin module that exports a `defaultSwapPolicy: TrustPolicy` constant and a `parsePolicyOverrides(input)` helper for CLI flags. No new `gate()` logic; just opinionated defaults for the swap use case.

### 2. Trading API client (`packages/core/trading.ts`)

New in `trust-swap/packages/core/`. A thin wrapper around `https://trade-api.gateway.uniswap.org/v1`.

The Trading API exposes more than the 3-step flow. Per `developers.uniswap.org/docs/api-reference`, the documented endpoints are:

| Group | Endpoints |
|---|---|
| Swapping | `/check_approval`, `/quote`, `/swap`, `/swaps/status`, swap calldata for EIP-5792 and EIP-7702 |
| Orders (UniswapX) | create/get gasless orders |
| Liquidity | check LP approvals; create / increase / decrease / claim-fees on V3 and V4 LPs; classic V2 LPs; pool info |
| Utilities | `/send` calldata, swappable tokens list, bridgable tokens list |
| Wallet ops | encode 7702 wallet transactions, get wallet delegation info |

For v1 we implement: `checkApproval`, `quote`, `swap`, `swapStatus`, and `swappableTokens`. Everything else (LP, EIP-7702, gasless order creation as a *server* rather than a client) is out of scope for TrustSwap but worth flagging in `FEEDBACK.md` — the API surface is broader than the agent skill currently teaches.

Responsibilities:

- Build typed request bodies from typed inputs.
- Handle routing-aware `permitData` rules (UniswapX excludes it from `/swap`; CLASSIC requires both `signature` and `permitData` together, or neither).
- Validate response shape before returning (`swap.data` non-empty hex; `swap.to` is a valid address).
- Expose typed errors for quote-expired, slippage-exceeded, insufficient-liquidity, 429 (rate-limited).
- Optional `swapStatus(orderHash | txHash)` for the daemon dashboard's polling loop.

The client does no signing. It returns a `SwapTransaction` ready for `signer.execute(batches)` against either `createLocalSigner` (EOA) or `createNameraSigner` (kernel account) — both come from `@synthesis/resolver`.

**Lower-level fallback path.** If the Trading API breaks during development, we can fall back to building Universal Router calldata locally via `@uniswap/universal-router-sdk` (in the `Uniswap/sdks` monorepo). The SDK's `SwapRouter.swapCallParameters(trade, options)` produces `{ calldata, value }` we feed into the same `Batch`. Keep this as a documented escape hatch, don't implement unless we hit a Trading API outage. Adds about ~200 lines and the dep `@uniswap/universal-router-sdk`, `@uniswap/sdk-core`, `@uniswap/v3-sdk` (or v4-sdk) for pool fetching.

### 3. Signer wiring (consumed from `@synthesis/resolver`)

The `Signer` interface and the `createLocalSigner` / `createNameraSigner` adapters ship in synthesis. TrustSwap is responsible for the *operational* setup that turns those generic adapters into a working signer:

- Provisioning the ZeroDev kernel account (one-time owner-key ceremony, off-droplet)
- Encrypting the owner key into `~/.synthesis/keystore.json`
- Issuing the first session key with the four onchain policies attached (`toCallPolicy`, `toGasPolicy`, `toRateLimitPolicy`, `toTimestampPolicy`) and serializing it to disk
- Funding the kernel account on Base
- Provisioning a Pimlico/Alchemy bundler URL
- Pre-installing the session-key validator (don't let lazy install be a stage event)

These ceremonies are TrustSwap-specific operator concerns. They're tracked in Phase 0 below. The synthesis adapter is intentionally policy-agnostic — *which* policies get installed is a choice the consuming app makes.

The four policies TrustSwap installs:

```typescript
toCallPolicy({
  permissions: [{
    target: UNIVERSAL_ROUTER_BASE,
    abi: UR_ABI,
    functionName: "execute",
    valueLimit: parseEther("0.005"),
  }],
  policyVersion: CallPolicyVersion.V0_0_4,
})
toGasPolicy({ allowed: parseEther("0.005") })
toRateLimitPolicy({ count: 1, interval: 3600 })
toTimestampPolicy({ validUntil: Math.floor(Date.now() / 1000) + 86400 })
```

**Atomic approve+swap.** Because the `Signer` interface accepts `Batch[]` and the Namera adapter passes them through `executeTransaction`, we collapse the Trading API's two transactions (`/check_approval` result + `/swap` result) into one batch:

```typescript
await signer.execute([{
  chainId: 8453,
  atomic: true,
  calls: [
    { to: approval.to, data: approval.data, value: BigInt(approval.value) },
    { to: swap.to,     data: swap.data,     value: BigInt(swap.value)     },
  ],
}]);
```

One bundler round trip, one validator pass, one onchain signature. This is a real DX win the kernel-account signer grants for free — flag it in `FEEDBACK.md` as a Trading API composition pattern that wouldn't be possible with EOA signing.

### 4. CLI command (`packages/cli/commands/swap.ts` in `trust-swap/`)

```bash
tru swap <recipient-ens> \
  --token-in <symbol|address>     # default USDC \
  --token-out <symbol|address>    # default WETH \
  --amount <n>                    # in human units \
  --chain <name>                  # default base \
  --min-tier <tier>               # default verified \
  --signer namera|local           # default namera if NAMERA_KEYSTORE_PATH set
  --dry-run                       # do everything except broadcast
```

Output: a transcript of the resolution, the gate decision (with reason), the quote (with route summary), and either the broadcast hash or the deny diagnostic. The `tru` binary is registered in `trust-swap/packages/cli/package.json` under `bin`.

### 5. Agent daemon mode (`packages/cli/commands/agent.ts` in `trust-swap/`)

```bash
tru agent run \
  --policy <policy.json>          # TrustPolicy + signal source
  --wallet <namera-account-id>    # Namera Smart Account
  --interval <seconds>            # default 60
  --max-iterations <n>            # default unbounded
```

Loop:

```
1. Pull signal: read SIGNAL_URL or pop from a small Redis queue
2. Resolve recipient ENS via @synthesis/resolver
3. Apply gate(profile, policy) — short-circuit on deny
4. Fetch /quote from Trading API
5. Sign with Namera session key
6. Broadcast
7. Append result to a JSONL log served at /agent/log on the site
```

Crash-only design — no resume state, no recovery logic. If a swap is in flight when the process dies, Namera's onchain rate-limit policy prevents duplication on restart.

### 6. Site `/swap` page (`trust-swap/packages/site/src/app/swap`)

Two inputs (recipient ENS + amount). Below them, a live trust card that resolves as the user types — five layer badges, a tier ribbon, the AIP lineage chain visualized as a horizontal trail of version stamps. The swap button is bound to the gate decision; below `verified`, the button is disabled with the deny reason inline; at `verified+`, the button enables and shows the live Trading API quote.

Reuses styling and components from the synthesis `/resolve` and `/trust` pages — copy the visual language at scaffold time, no new design system work. The component primitives can be lifted directly from `synthesis/packages/site/src/app/trust/` since this is a hackathon submission, not a productized fork; revisit if it needs to live on long-term.

### 7. Site `/agent` page (`trust-swap/packages/site/src/app/agent`)

The droplet's window into itself. Server-side reads of:

- Current kernel account address (with link to BaseScan)
- Current onchain policy state (rate-limit window, gas remaining, expiry from `toTimestampPolicy.validUntil`)
- Last 10 swap attempts: timestamp, recipient ENS, gate decision, user-op hash, terminal status from `/swaps/status`
- Live tail of `/agent/log` via Server-Sent Events

The status column polls the Trading API's `/swaps/status` endpoint until each swap reaches a terminal state (`SUCCESS`, `FAILED`, `EXPIRED`). This is what makes the dashboard *live* rather than a static log.

This is the demo's screen-share artifact: open `/agent` in a browser and watch the daemon work in real time.

### 8. MCP server (`trust-swap/packages/mcp`)

A Model Context Protocol server exposing one tool, `trust_gated_swap`, with the same parameters as the CLI. Run standalone via `npx trust-swap-mcp`. Lets any MCP-aware host (Claude, GPT, Bankr) call TrustSwap as a tool with policy enforcement built in. This is the public-good distribution surface — every MCP host gets trust-gated settlement for free.

## File layout (new repo)

The TrustSwap repo is a fresh pnpm workspace at `~/trust-swap/` with `estmcmxci/trust-swap` as origin. It depends on `@synthesis/resolver` (and `@synthesis/cli` for the `ensemble gate` inspector) via `file:../synthesis/packages/{resolver,cli}` during local development; published npm versions before judging.

```
trust-swap/
  package.json                          pnpm workspace root
  pnpm-workspace.yaml
  tsconfig.base.json
  biome.json
  .gitignore
  PLAN.md                               this file (moved from synthesis/plans/trust-gated-swap.md)
  README.md                             one-paragraph pitch + link to synthesis
  FEEDBACK.md                           required by Uniswap track
  spec/
    trust-gated-swap.md                 short pattern spec for forkers
  packages/
    core/
      package.json                      depends on @synthesis/resolver
      src/
        policy.ts                       defaultSwapPolicy + parsePolicyOverrides
        trading.ts                      Uniswap Trading API client
        orchestrate.ts                  resolve + gate + quote + sign composition
        index.ts                        barrel exports
    cli/
      package.json                      bin: { tru: ./dist/index.js }
      src/
        index.ts                        incur entry, registers commands
        commands/
          swap.ts                       tru swap
          agent.ts                      tru agent run
    site/
      package.json                      Next.js app
      src/app/
        swap/
          page.tsx                      swap UI
          actions.ts                    server actions
        agent/
          page.tsx                      daemon dashboard
          log/route.ts                  SSE log tail
        api/
          gate/route.ts                 POST { ens, policy } → decision
    mcp/
      package.json                      bin: { trust-swap-mcp: ./dist/index.js }
      src/index.ts                      MCP server entry
  infra/
    droplet/
      systemd/trust-swap-agent.service  daemon unit file
      cloud-init.yaml                   provision script

synthesis/                              (existing repo, unchanged by this plan)
  plans/
    trust-gated-swap.md                 this file lives here pre-scaffold; moves to trust-swap/PLAN.md once the repo is created
    trl-policy-and-signers.md           the Layer A plan this depends on
```

**Pre-scaffold note.** This plan currently lives at `synthesis/plans/trust-gated-swap.md`. Once `trust-swap/` is scaffolded (Phase −1.B), it moves to `trust-swap/PLAN.md` and the synthesis copy becomes a one-line stub: *"TrustSwap is built in `estmcmxci/trust-swap`. See trl-policy-and-signers.md for the synthesis-side prerequisites."*

## Build sequence

Critical path is everything through Phase 3. Phases 4–5 are stretch and can be cut.

### Phase −1.A — Synthesis PR landed (blocking, owned by `plans/trl-policy-and-signers.md`)

- [ ] `gate()`, `TrustPolicy`, `GateDecision` exported from `@synthesis/resolver`
- [ ] `Signer`, `Batch`, `createLocalSigner`, `createNameraSigner` exported from `@synthesis/resolver`
- [ ] `ensemble gate <ens>` registered in `@synthesis/cli`
- [ ] `@synthesis/resolver@0.2.0` and `@synthesis/cli@<bumped>` either published to npm OR available via `file:` dep from `~/synthesis/packages/{resolver,cli}`

If any of these are missing when Phase −1.B starts, stop and finish the synthesis PR first.

### Phase −1.B — Repo scaffold (Day 0, ~2 hours)

Bring the new repo and its toolchain online so Phase 0 has somewhere to land code.

- [ ] `mkdir ~/trust-swap && cd ~/trust-swap && git init`
- [ ] `gh repo create estmcmxci/trust-swap --private --source=. --remote=origin`
- [ ] Move `synthesis/plans/trust-gated-swap.md` → `trust-swap/PLAN.md`. Replace the synthesis copy with a one-line stub pointing at the new repo.
- [ ] Scaffold pnpm workspace: root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `.gitignore`. Match synthesis's tooling choices for consistency.
- [ ] Create empty package skeletons: `packages/{core,cli,site,mcp}` each with `package.json`, `tsconfig.json`, `src/index.ts`. Compile-only, no logic.
- [ ] Wire `@synthesis/resolver` and `@synthesis/cli` as `file:` deps in the packages that consume them (`core`, `cli`, `site`, `mcp`).
- [ ] Smoke-import test in `packages/core/src/index.ts`: `import { gate, type Signer } from "@synthesis/resolver";` — confirms the dep wiring works before any TrustSwap code is written.
- [ ] `README.md` (one-paragraph pitch + link to synthesis), placeholder `FEEDBACK.md` and `spec/trust-gated-swap.md` (headers only, filled in during build).
- [ ] Initial commit + push to `origin/main`.

### Phase 0 — Operational readiness (Day 1, half day)

Run the one-time ceremonies and credential setup that turn the generic synthesis primitives into a working signer for TrustSwap. These produce on-disk artifacts that the daemon and CLI consume.

- [ ] Confirm `getEnsAddress` works for our test recipients (`emilemarcelagustin.eth` and one externally-controlled name) — sanity check synthesis is healthy on the network we're targeting.
- [ ] Register at developers.uniswap.org → obtain `UNISWAP_API_KEY`. Store in `trust-swap/.env.local` and add to `.env.example` (placeholder).
- [ ] Sign up for a Base ERC-4337 bundler (Pimlico free tier preferred; Alchemy as alt). Store `BUNDLER_URL_BASE` in `.env.local`. Note free-tier quota in repo README.
- [ ] Smoke-test the Uniswap API key with a single `/quote` for a known pair (USDC→WETH on Base). 200 OK = key is live.
- [ ] Smoke-test the bundler URL with `eth_supportedEntryPoints`. Non-empty response = bundler is live on Base.
- [ ] Add `NAMERA_KEYSTORE_PATH=/home/<user>/.synthesis/keystore.json` and `NAMERA_SESSION_KEY_PATH=/home/<user>/.synthesis/session-key.json` placeholders to `.env.example`.
- [ ] Run `createAccountClient({ type: "ecdsa", ... })` once with a fresh ECDSA owner key → record the deterministic kernel account address. Fund it on Base with ~$20 USDC + $5 ETH for the early swaps and the lazy validator-install gas.
- [ ] Encrypt the owner key into a keystore JSON at `~/.synthesis/keystore.json`. The droplet will get the *session key serialization* only, never this file.

### Phase 1 — Trading API + session key + CLI dry run (Day 1.5, full day)

- [ ] Implement `packages/core/trading.ts` with `checkApproval`, `quote`, `swap` functions and routing-aware `permitData` handling. Tests use recorded responses for both CLASSIC and DUTCH_V2 routes.
- [ ] Implement `packages/core/policy.ts` exporting `defaultSwapPolicy` (a `TrustPolicy` with `minTier: "verified"`, `requireLineage: true`, `requireSig: true`, `allowSelf: true`) and `parsePolicyOverrides(input)` for CLI flags. Five-line module — no `gate()` logic, just defaults.
- [ ] Implement `packages/core/orchestrate.ts` — the `resolve → gate → quote → sign` composition. Pure async function, no I/O dependencies beyond what's passed in. Reused by CLI, server actions, daemon, and MCP.
- [ ] Issue first session key locally (one-time, owner-key-required ceremony) with the four onchain policies attached (`toCallPolicy` for Universal Router, `toGasPolicy`, `toRateLimitPolicy`, `toTimestampPolicy`). Serialize via `@namera-ai/sdk/session-key`. Save to `~/.synthesis/session-key.json`. The synthesis-side `createNameraSigner` consumes this file; the policies themselves are TrustSwap's choice.
- [ ] Implement `packages/cli/src/commands/swap.ts` — wires `orchestrate()` to the CLI surface.
- [ ] End-to-end CLI test: `tru swap testname.eth --amount 0.5 --signer local --dry-run` — completes the resolve + gate + quote flow without broadcasting.

### Phase 2 — Live broadcast (Day 2.5, half day)

- [ ] First real swap: small USDC→WETH on Base with `--signer local`. Verify on BaseScan.
- [ ] Pre-install the session key validator on the kernel account: call `isSessionKeyInstalled` first; if false, trigger an installation via the owner client. (This is the lazy install — eat the gas now, not on stage.)
- [ ] Same swap with `--signer namera` using the atomic approve+swap batch. Verify session key signature path works end-to-end and the user op shows on BaseScan with the kernel account address as `from`.
- [ ] Negative path: target an ENS name with tier `none`. Confirm the gate denies and no quote is fetched.
- [ ] Negative path 2: try a swap with the session key against a non-Universal-Router target. Confirm the ZeroDev validator rejects on-chain (this is the imperative-policy demo screenshot).

### Phase 3 — Site UI (Day 3, full day)

- [ ] `/swap` page with the live trust card and gate-bound button. Mobile-decent, not pixel-perfect.
- [ ] Token picker on `/swap` populated from Trading API's swappable-tokens endpoint (cache the response — it's stable enough).
- [ ] `/api/gate` server action — used by the page and exposed as a public endpoint.
- [ ] `/agent/status/[hash]` — proxies `/swaps/status` polls to the dashboard.
- [ ] One screenshot test capturing the deny state for the demo backup.

### Phase 4 — Droplet daemon (Day 4, full day) — STRETCH but high-leverage

- [ ] DigitalOcean droplet (or Fly.io machine — whichever is faster). Smallest tier; this is a demo box.
- [ ] systemd unit running `tru agent run` against a tiny mock signal source (HTTP endpoint we control).
- [ ] `/agent` page on the site with SSE log tail.
- [ ] Test: trigger a signal, watch the daemon resolve → gate → quote → sign → broadcast on screen.

### Phase 5 — A2A coordination (Day 5, full day) — STRETCH

- [ ] Second droplet running the same daemon under a second ENS name.
- [ ] Each daemon exposes a `POST /intents` endpoint (TLS, signed). Endpoint URL stored in `agent-endpoint` text record on each ENS name (discovered via ENSIP-26).
- [ ] Demo flow: `alice-agent.eth` posts intent → `bob-agent.eth` reads it, resolves Alice via TRL, accepts → both daemons run their swaps. Two-sided gate.

### Cut lines (in order)

If we run short on time, cut in this order:

1. Cut Phase 5 (A2A). The story still hits two prize tracks without it.
2. Cut Phase 4 droplet — run the daemon from a laptop during demo. Lose the "live on a server" magic; keep autonomy.
3. Cut the MCP server — the CLI alone is enough for the public-good claim.
4. Cut the atomic approve+swap batch — submit two separate user ops. Lose one DX talking point; keep correctness.
5. Cut Namera entirely, fall back to `createLocalSigner` with an EOA. Lose the wallet-policy story; keep TRL-policy story. Be ready to explain why two policy layers were the original design.
6. Cut UniswapX-specific routing — stay on CLASSIC. Lose minor depth in the Uniswap pitch; keep the headline.

## Demo script (90 seconds)

```
[0:00–0:15]  Open /swap on the site. Type "emilemarcelagustin.eth"
             into the recipient field. The trust card resolves live —
             five badges light up green, tier ribbon flips to "full",
             lineage chain shows v1 → v2 with intact signatures.
             Quote renders. Sign and broadcast a small USDC→WETH swap.
             Tx hash links to BaseScan.

[0:15–0:30]  Replace recipient with "random-eoa.eth" — an EOA we
             control with no TRL setup. Trust card resolves to tier
             "none". Swap button is disabled. Deny reason: "tier none
             below required verified; no manifest found." No quote
             fetched.

[0:30–0:45]  Replace with "tampered.eth" — same address as a known
             good name, but with a manifest signature mismatch.
             Trust card shows green for personhood + identity but
             RED for manifest with the lineage chain broken at v2.
             Tier drops to "discoverable". Swap denied. Diagnostic:
             "manifest signature does not match current ENS owner."

[0:45–1:15]  Switch to /agent. The daemon dashboard. Live log tail
             shows three swap attempts in the last hour, each with
             gate decision and tx hash. Open BaseScan, click through
             to one of the broadcast txs — Namera Smart Account →
             Universal Router on Base, real swap, real value moved.

[1:15–1:30]  Close: "Three primitives composing — TRL for who,
             Namera for what, Uniswap for the move. Each can be
             swapped out; together they're trust-gated agentic
             settlement."
```

## FEEDBACK.md outline (Uniswap prize requirement)

Required at repo root. Draft headers — to be filled in during the build with concrete observations:

```markdown
# FEEDBACK.md — TrustSwap experience report on the Uniswap Trading API

## What worked
- 3-step flow is genuinely well-shaped — easy to compose with a pre-flight policy layer
- Routing-type discriminated union (CLASSIC | DUTCH_V2 | DUTCH_V3 | PRIORITY) made it
  natural to write routing-aware code paths
- Excellent edge-case docs in @uniswap/uniswap-ai (UniswapX permitData rules, L2 WETH,
  CORS, wagmi v2 useWalletClient pitfalls). This is rare and valuable.

## What didn't / friction we hit
- No native ENS in API inputs — every agent framework has to bolt on resolution
  client-side. Proposal: accept `swapper` and `recipient` as ENS names, server-side
  resolve, return both the resolved address and the canonical name in the response.
- No policy hook surface — there's no way to say "only quote routes that pass an
  external check" mid-flow. We had to invert: gate before quote, not during.
- Quote freshness (~30s) interacts poorly with multi-step pre-flight checks. By the
  time we resolve TRL + walk lineage + verify signatures, a quote can stale.
  Proposal: a `recipient-attestation` opaque field that quote/swap carry forward
  immutably, so the pre-flight result binds to the quote.
- The /swap body shape (spread the quote response, strip null permitData) is a
  footgun. Three of our integration bugs traced to this. Proposal: `quote_id` field
  in /quote response, used as the only required input to /swap.

## Bugs / docs gaps
- developers.uniswap.org has no llms.txt, no SKILL.md, no OpenAPI/Swagger spec exposed.
  The agent-readable surface is uniswap-ai (a separate repo), and the docs site only
  hints at it via `npx skills add uniswap/uniswap-ai`. Proposal: publish llms.txt or
  llms-full.txt at the docs root and link it from /docs, so AI integration tooling
  can discover the canonical agent surface without scraping.
- /openapi.json is not exposed at the trade-api gateway (returns 403). Without it,
  every consumer reverse-engineers the schema from prose. Publishing the spec
  privately to API key holders would unlock typed clients for free.
- The api-reference page documents many endpoints (LP lifecycle, /swaps/status,
  EIP-7702 calldata, /send, swappable/bridgable tokens) that the swap-integration
  SKILL.md does not cover. Skill coverage trails API surface — agents using the
  skill don't know about these endpoints.

## Missing endpoints / what we wished existed
- ENS-typed inputs everywhere (swapper, recipient)
- A `/policy` endpoint accepting JSON-Schema describing a pre-flight check, returned
  in the quote so verifiers can confirm the policy was enforced
- Webhook for swap completion (we currently poll /swaps/status)
- Native ERC-4337 user-op calldata endpoint that returns a Batch ready for
  account-abstraction wallets like Namera/ZeroDev (we currently rebuild it ourselves)

## DX friction
- No batched check_approval + quote in one call (we always need both)
- Rate limits not surfaced in headers — we hit 429s without warning
- The /swap body shape (spread the quote response, strip null permitData, route-
  aware permitData handling) is the single biggest footgun. We hit three bugs here.
  Proposal: opaque `quote_id` in /quote response, used as the only required input
  to /swap. The full route info stays server-side; clients pass an ID.
- ai-toolkit and uniswap-ai are easy to confuse. uniswap-ai = external agent
  integration skills; ai-toolkit = internal Uniswap dev workflow. Worth a one-line
  disambiguation in either README.
```

This is substantive feedback because we *attempted to compose* with the API rather than just call it. Judges read these.

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Namera SDK hits an unforeseen integration bug | Medium | `createLocalSigner` from `@synthesis/resolver` is the fallback. Demo can switch with one env var change (`--signer local`). SDK is at v0.1.0 and unaudited per `TODOS.md`. |
| Pimlico/Alchemy bundler downtime or rate-limiting | Medium | Configure two bundler URLs in env; signer auto-fails over. Sponsorship credits are free-tier — verify quota before judging week. |
| ZeroDev validator install fails on first session-key use | Medium | Pre-install in Phase 2. Don't let "lazy install" be a stage event. |
| Trading API rate-limits during demo | Low | Pre-cache one successful quote + swap for backup; record video as final fallback |
| Droplet networking flakiness on stage | Medium | Mirror the daemon log to the site via SSE. The site (Vercel) is the screen-share target, not the droplet directly. |
| TRL resolver returns stale data for a freshly set ENS record | Medium | Set all demo records ≥24h before the hackathon judging window. Pre-warm a Pinata IPFS pin. |
| AIP manifest layer not yet fully wired in synthesis | High | Owned by `plans/trl-policy-and-signers.md` Phase A.0 — must be audited as part of the synthesis PR, not here. If TrustSwap Phase −1.A starts and the manifest layer is broken, push back to synthesis. |
| Judges interpret "agent" narrowly as "LLM-driven" and we don't have an LLM in the swap path | Low | The MCP server makes any LLM a TrustSwap host. Demo a Claude session calling the MCP tool if needed. |
| Signet collision (judges saw a similar shape at Cannes 2026) | Low | Lead the demo with the *tampering* scenario at 0:30 — Signet cannot do lineage verification. |
| Session key leaks from droplet | Low impact | Onchain policy bounds blast radius: at most 1 swap/hour, ≤$5 gas, only Universal Router with our recipient address, expires in 24h. We *cannot* yet revoke from the daemon — `revokeSessionKey` requires the owner key, which lives in the encrypted keystore off-VM. Time-bound expiry is the primary safeguard. |

## Public-good × reference-spec deliverables

Three artifacts other projects can fork:

1. **`@synthesis/resolver@0.2.0` with `gate()` and `Signer`** — shipped via the synthesis PR (`plans/trl-policy-and-signers.md`), published to npm. Anyone — not just TrustSwap — can adopt the gate-then-execute pattern in a few lines. Trust providers other than TRL can plug in by producing a `TrustProfile`-shaped object.

2. **TrustSwap repo (`estmcmxci/trust-swap`)** — the reference *application* on top of those primitives. Composes TRL + Namera + Uniswap Trading API. The CLI, site, and MCP server are the three reference surfaces.

3. **`spec/trust-gated-swap.md`** — short markdown describing the convention: the policy fields, the gate decision shape, the recommended pre-flight ordering, and the error semantics for denials. Pitched as a draft for an ENSIP-style document if it gains traction. The synthesis lib is the reference implementation of the *primitives*; this repo is the reference implementation of the *application*; the spec is the public good that ties them together.

## Out of scope

Explicitly not in v1:

- Custom v4 hook deployment (the post-1.0 stretch — see UniKits for prior art)
- A full Identity DEX (per-ENS-name token routing) — too ambitious, dropped earlier
- x402 paywall composition — distinct project, possible follow-up
- Anonymous trust proofs (zk attestations) — TRL today is fully transparent
- Cross-chain routing — single chain (Base) for v1; Trading API supports it but the demo doesn't benefit

## Open questions before coding

1. ~~Does Namera's Call Policy operate on `(target, selector)` or on full calldata?~~ **Answered by reading the namera SDK README + `policy/index.ts`:** `toCallPolicy` accepts `permissions[]` of `{ target, abi, functionName, args, valueLimit }`, where `args` supports per-argument `ParamCondition` (e.g. `LESS_THAN_OR_EQUAL`). For Universal Router's `execute(commands, inputs, deadline)`, we can pin `target` to the Base UR address and constrain `valueLimit`, but `commands` is `bytes` and `inputs` is `bytes[]` — argument-level conditions on opaque calldata are limited. So Namera gates "you can only call execute() on the Universal Router with at most X ETH attached"; TRL gates "the recipient is verified." Together they're tight; neither alone is. Plan stands.
2. Does the Trading API surface a stable `quote_id` we can pass to `/swap`? If yes, our quote-freshness mitigation simplifies. (Open — investigate during Phase 1 implementation.)
3. Do we want the gate decision to be *itself* signed and stored as a text record (`last-gate-decision`) for after-the-fact auditability, or kept off-chain only? Tradeoff: signed decisions are a more compelling audit story but add a write per swap.
4. ~~Should we expose Namera's `executeTransaction` batched shape through the `Signer` interface, or hide it behind a single `executeSwap(...)` call?~~ **Resolved in `plans/trl-policy-and-signers.md`:** the synthesis `Signer` interface ships with `execute(batches: Batch[])` exposed — other Trading-API-on-AA-wallet consumers get the batch shape for free. TrustSwap doesn't get a vote here.
5. **NEW:** Do we contribute the atomic approve+swap pattern back to `Uniswap/uniswap-ai` as a new skill (`swap-via-aa-wallet`)? Bridges our `FEEDBACK.md` into a real PR. Worth doing post-hackathon regardless of prize outcome.
