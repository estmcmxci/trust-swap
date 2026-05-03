# TrustSwap

> **Reputation-graded settlement — settle with anyone the chain says you should.**

A programmable trust layer between any two parties and the Uniswap pools they use. Every swap routes through `TrustSwapRouter`, an on-chain contract that verifies an off-chain trust attestation and applies **tier-graded execution terms** (per-tier caps + fees) before forwarding to Uniswap's Universal Router. Each side can publish a **`RiskPolicy`** advertising what counterparties they will accept; both sides' policies must be satisfied before the oracle signs.

Five primitives compose, each doing one job:

| Layer | Provider | Job |
|---|---|---|
| **TRL substrate** | [`@synthesis/resolver`](https://github.com/estmcmxci/synthesis/tree/main/packages/resolver) | "Resolve `<ens>` to a 5-layer `TrustProfile`." |
| **TrustSwap Oracle** | This repo (`packages/oracle`) | "Re-resolve both sides, check published RiskPolicies, sign an attestation." |
| **TrustSwapRouter** | This repo (`packages/contracts`) | "Verify the oracle signature, look up tier-bucket terms, forward to Universal Router." |
| **Uniswap Trading API** | Uniswap Foundation | "Generate optimal swap calldata for the underlying pools." |
| **Wallet / session-key policy** | `@namera-ai/sdk` over ZeroDev | "Bound what the session key can call, with what value, how often." |

The router enforces the *intersection* of (router floor, swapper's tier-derived terms, recipient's published RiskPolicy). Most restrictive wins. Tier `none` is the only outright admission denial — every other tier is admitted with graded terms.

## Live evidence

<!-- LIVE_DEMO_BULLET -->
- **Headline transaction (Base):** [`0xfe6f2308…`](https://basescan.org/tx/0xfe6f2308701fc19074fa84304efcb6dbd5e4cb14e06d91e91028e471a23a88f5) — `daemon.emilemarcelagustin.eth` peer-fulfilled `daemon.trustrust.eth`'s swap intent end-to-end without human input.
- **JSONL captures:** [`infra/demo-runs/phase-6/`](./infra/demo-runs/phase-6/) — paired allow + deny lifecycle events with a README explaining the five gate checks.
- **ENS records (mainnet):** [`daemon.emilemarcelagustin.eth`](https://app.ens.domains/daemon.emilemarcelagustin.eth) and [`daemon.trustrust.eth`](https://app.ens.domains/daemon.trustrust.eth) — published `agent-risk-policy`, `agent-version-lineage`, `agent-latest`, `agent-ids`, `agent-endpoint`, `addr`.
- **Spec:** [`spec/trust-graded-swap.md`](./spec/trust-graded-swap.md).
- **Replay locally:** `cat infra/demo-runs/phase-6/allow-2026-05-02.jsonl | jq -c .` shows the full peer-fulfillment lifecycle. Agent endpoints live on Tailscale-private IPs by design (Phase 6c lockdown — only daemon peers can reach `/intents`); see [`infra/droplet/install.sh`](./infra/droplet/install.sh).

The companion synthesis Trust Resolution Layer ([`@synthesis/resolver@0.2.0`](https://github.com/estmcmxci/synthesis/tree/main/packages/resolver)) ships the `gate()` policy primitive and `Signer` interface this app composes against — see the [trust-policy spec](https://github.com/estmcmxci/synthesis/blob/main/spec/trust-policy.md).

## Specification

The graded-router pattern + RiskPolicy schema is formalized in [`spec/trust-graded-swap.md`](./spec/trust-graded-swap.md). It is published as a draft convention, pitched as a future ENSIP if adoption extends beyond this project.

## Workspace layout

```
trust-swap/
├── PLAN.md                         execution plan
├── FEEDBACK.md                     Uniswap prize requirement — experience report on the Trading API
├── spec/
│   └── trust-graded-swap.md        graded-router + RiskPolicy convention
└── packages/
    ├── core/                       Trading API client + orchestrate + RiskPolicy fetcher + tier-bucket TABLE
    ├── cli/                        `tru` binary — swap, policy publish/show, agent run
    ├── site/                       Next.js — /swap, /policy, /agent
    ├── mcp/                        MCP server exposing trust_gated_swap tool
    ├── contracts/                  Solidity — TrustSwapRouter (Foundry-managed)
    └── oracle/                     HTTP signing service (Vercel/CF Workers)
```

Each package's `README.md` documents its own surface as it lands.

## Hackathon prize tracks

- **OpenAgents ENS** — Best Integration for AI Agents
- **Uniswap Foundation** — Best API Integration

## License

MIT.
