import {
  TrustPolicySchema,
  type TrustPolicy,
  type TrustTier,
} from "@synthesis/resolver";

/**
 * Default `gate()` policy applied to every TrustSwap operation when no caller
 * override is supplied.
 *
 * The router's tier-bucket terms admit four tiers (registered → full) with
 * graded caps + fees; only `none` outright reverts. The off-chain `gate()`
 * pre-flight mirrors that floor — `minTier: "registered"` produces useful
 * onboarding diagnostics for tier=none recipients without blocking the four
 * eligible tiers.
 *
 * **NOTE — Solidity mirror.** The router's `maxTradeSize()` and `feeBps()`
 * functions in `packages/contracts/src/TrustSwapRouter.sol` (Phase 2) must
 * stay byte-for-byte equivalent to the `tierBucket` table below. Any change
 * here must update the contract, and vice versa.
 */
export const defaultSwapPolicy: TrustPolicy = {
  minTier: "registered",
  requireLineage: true,
  requireSig: true,
  allowSelf: true,
};

/**
 * Tier-bucketed execution terms. Mirrored byte-for-byte by the Solidity
 * `TrustSwapRouter` in Phase 2.
 *
 * - `maxTradeSize` is denominated in USDC base units (6 decimals). The router
 *   normalizes each swap's input value to USDC equivalence before comparing.
 * - `feeBps` is the per-swap fee in basis points (1 bp = 0.01%).
 *
 * Tier `none` is the floor: the router reverts on it. The `0n` / `0` entries
 * here are revert sentinels — consumers MUST early-return before consulting
 * the bucket for a `none` swapper or recipient.
 */
export const tierBucket: Record<
  TrustTier,
  { maxTradeSize: bigint; feeBps: number }
> = {
  none: { maxTradeSize: 0n, feeBps: 0 },
  registered: { maxTradeSize: 50_000_000n, feeBps: 100 },
  discoverable: { maxTradeSize: 500_000_000n, feeBps: 50 },
  verified: { maxTradeSize: 5_000_000_000n, feeBps: 25 },
  full: { maxTradeSize: 2n ** 256n - 1n, feeBps: 0 },
};

/**
 * Merge caller overrides over `defaultSwapPolicy`, validating the result via
 * the synthesis-side `TrustPolicySchema`. Any field omitted from `input`
 * inherits its default; unrecognized fields throw.
 */
export function parsePolicyOverrides(
  input: Partial<TrustPolicy> = {},
): TrustPolicy {
  return TrustPolicySchema.parse({ ...defaultSwapPolicy, ...input });
}
