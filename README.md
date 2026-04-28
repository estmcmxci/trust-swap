# TrustSwap

> **Swap with people you can prove are who they claim to be.**

A reference implementation of the **gate-then-execute** pattern: every Uniswap swap is gated by a TRL resolution of the counterparty, signed by a policy-bound agent wallet, and settled through the Uniswap Trading API.

Three primitives compose, each doing one job:

| Layer | Provider | Job |
|---|---|---|
| Identity / semantic policy | [`@synthesis/resolver`](https://github.com/estmcmxci/synthesis/tree/main/packages/resolver) (TRL) | "Is the counterparty who they claim to be, at the tier I require?" |
| Wallet / imperative policy | `@namera-ai/sdk` over ZeroDev kernel accounts | "Can this session key call this target, with these args, within these gas / rate / time bounds?" |
| Settlement | Uniswap Trading API | "Quote and execute the swap." |

Neither identity nor wallet policy alone is sufficient. Both gates must agree before any user op broadcasts.

## Status

**Phase −1.B (scaffold).** See [`PLAN.md`](./PLAN.md) for the full execution plan and current phase.

The companion synthesis Trust Resolution Layer (`@synthesis/resolver@0.2.0`) ships the `gate()` policy primitive and `Signer` interface this app composes against — see the [trust-policy spec](https://github.com/estmcmxci/synthesis/blob/main/spec/trust-policy.md).

## Workspace layout

```
trust-swap/
├── PLAN.md                          execution plan (mirrored from synthesis/plans/)
├── FEEDBACK.md                      Uniswap prize requirement — experience report on the Trading API
├── spec/
│   └── trust-gated-swap.md          short pattern spec for forkers
└── packages/
    ├── core/                        gate-then-execute composition + Trading API client
    ├── cli/                         `tru` binary — swap, agent run
    ├── site/                        Next.js — /swap, /agent
    └── mcp/                         MCP server exposing trust_gated_swap tool
```

Each package's `README.md` documents its own surface as it lands.

## Hackathon prize tracks

- **OpenAgents ENS** — Best Integration for AI Agents
- **Uniswap Foundation** — Best API Integration

## License

MIT.
