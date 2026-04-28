# Trust-Gated Swap (Pattern Draft)

> Placeholder — full convention spec for the `resolve → gate → quote → sign → broadcast` pattern lands during Phase 4. Current state is the implementation in [`packages/core`](../packages/core).

## Sketch

The pattern composes three independent primitives:

1. **Resolve** the counterparty's `TrustProfile` via `@synthesis/resolver`'s `resolve(ensName)`.
2. **Gate** the profile against a `TrustPolicy` (minimum tier, lineage, signature requirements) via `@synthesis/resolver`'s `gate(profile, policy, callerEns?)`. Pre-flight, before any quote is fetched. See [`@synthesis/resolver`'s trust-policy spec](https://github.com/estmcmxci/synthesis/blob/main/spec/trust-policy.md).
3. **Settle** via the Uniswap Trading API (`/check_approval → /quote → /swap`), signed by either a viem-based EOA (`createLocalSigner`) or a ZeroDev kernel account (`createNameraSigner`) — both implementing the same `Signer` interface from `@synthesis/resolver`.

Both gates (TRL semantic + Namera imperative) must agree before a user op broadcasts.

## See also

- [`PLAN.md`](../PLAN.md) — execution plan
- [`@synthesis/resolver` trust-policy spec](https://github.com/estmcmxci/synthesis/blob/main/spec/trust-policy.md)
