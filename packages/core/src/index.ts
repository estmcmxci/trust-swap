/**
 * @trust-swap/core — Phase −1.B scaffold
 *
 * Smoke-import test for the @synthesis/resolver file: dep wiring. The real
 * exports (Trading API client, defaultSwapPolicy, orchestrate function)
 * land in Phase 1 per ../PLAN.md.
 */

import {
  gate,
  type GateDecision,
  type Signer,
  type TrustPolicy,
  type TrustProfile,
} from "@synthesis/resolver";

// Re-export the TRL primitives this app composes against, so downstream
// packages can `import { gate, ... } from "@trust-swap/core"` without
// reaching into @synthesis/resolver directly.
export {
  gate,
  type GateDecision,
  type Signer,
  type TrustPolicy,
  type TrustProfile,
};

/** Phase −1.B sentinel — confirms the package builds and re-exports work. */
export const SCAFFOLD_VERSION = "0.0.0-scaffold" as const;
