/**
 * @trust-swap/core
 *
 * Composes the synthesis Trust Resolution Layer (TRL) substrate against
 * Uniswap's Trading API and the on-chain TrustSwapRouter. Re-exports the
 * upstream primitives we depend on so consumers don't have to import from
 * `@synthesis/resolver` directly.
 */

import {
  gate,
  type GateDecision,
  type Signer,
  type TrustPolicy,
  type TrustProfile,
  TrustTier,
} from "@synthesis/resolver";

export {
  gate,
  type GateDecision,
  type Signer,
  type TrustPolicy,
  type TrustProfile,
  TrustTier,
};

export {
  defaultSwapPolicy,
  tierBucket,
  parsePolicyOverrides,
} from "./policy.js";

export {
  RiskPolicySchema,
  RiskPolicyError,
  parseRiskPolicy,
  resolveRiskPolicy,
  type RiskPolicy,
  type ResolveRiskPolicyOptions,
} from "./risk-policy.js";

export {
  orchestrate,
  buildGatedSwapCalldata,
  createMockOracleClient,
  createHttpOracleClient,
  OracleRefusalError,
  PLACEHOLDER_ROUTER_ADDRESS,
  type OracleClient,
  type CreateMockOracleClientOptions,
  type CreateHttpOracleClientOptions,
  type OrchestrateOptions,
  type OrchestrateResult,
  type ClampApplied,
  type HaltReason,
} from "./orchestrate.js";

// Re-export attestation types so consumers don't need a direct dep on @trust-swap/oracle.
export type {
  AttestRequest,
  AttestResponse,
  AttestErrorResponse,
  Attestation,
} from "@trust-swap/oracle";

export {
  createTradingClient,
  prepareSwapRequest,
  isUniswapXQuote,
  getOutputAmount,
  TradingApiError,
  QuoteExpiredError,
  SlippageExceededError,
  InsufficientLiquidityError,
  RateLimitedError,
  InvalidResponseError,
  type TradingClient,
  type TradingClientOptions,
  type CheckApprovalInput,
  type CheckApprovalResponse,
  type Approval,
  type QuoteInput,
  type QuoteResponse,
  type ClassicQuote,
  type UniswapXQuote,
  type DutchOrderOutput,
  type SwapInput,
  type SwapResponse,
  type SwapTransaction,
  type SwapStatusInput,
  type SwapStatusResponse,
  type SwappableTokensInput,
  type SwappableTokensResponse,
  type TokenInfo,
  type Routing,
  type RoutingPreference,
  type Protocol,
  type QuoteType,
} from "./trading.js";
