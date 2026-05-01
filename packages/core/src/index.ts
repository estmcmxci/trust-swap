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
  cachedResolveTrustProfile,
  clearResolverCache,
  getResolverCacheSnapshot,
  type CachedResolveOptions,
} from "./resolver-cache.js";

export {
  RiskPolicySchema,
  RiskPolicyError,
  parseRiskPolicy,
  resolveRiskPolicy,
  resolveRiskPolicyWithProvenance,
  resolveAgentEndpoint,
  publishRiskPolicy,
  serializeRiskPolicy,
  type RiskPolicy,
  type ResolveRiskPolicyOptions,
  type ResolveAgentEndpointOptions,
  type RiskPolicyProvenance,
  type RiskPolicyResolution,
  type PublishRiskPolicyOptions,
  type PublishRiskPolicyResult,
  type PublishRiskPolicyStorage,
} from "./risk-policy.js";

export {
  OperatingPolicySchema,
  OperatingPolicyError,
  parseOperatingPolicy,
  loadOperatingPolicyFromDisk,
  watchOperatingPolicy,
  type OperatingPolicy,
  type OperatingPolicyAgent,
  type OperatingPolicyIntent,
  type OperatingPolicyConstraints,
  type WatchOperatingPolicyOptions,
  type WatchOperatingPolicyHandle,
} from "./operating-policy.js";

export {
  orchestrate,
  buildGatedSwapCalldata,
  createMockOracleClient,
  createHttpOracleClient,
  resolveWithSubnameInheritance,
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

export type {
  AttestRequest,
  AttestResponse,
  AttestErrorResponse,
  Attestation,
} from "./attestation.js";

export {
  createTradingClient,
  prepareSwapRequest,
  isUniswapXQuote,
  getOutputAmount,
  valueInUsdc,
  getUsdcAddress,
  USDC_BY_CHAIN,
  type ValueInUsdcArgs,
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
  type SwapEntry,
  type OrderStatusInput,
  type OrderStatusResponse,
  type OrderEntry,
  type SwappableTokensInput,
  type SwappableTokensResponse,
  type TokenInfo,
  type Routing,
  type RoutingPreference,
  type Protocol,
  type QuoteType,
} from "./trading.js";
