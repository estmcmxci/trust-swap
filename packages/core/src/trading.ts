import { isAddress, isHex, type Address, type Hex } from "viem";

// ---------------------------------------------------------------------------
// Public API surface
//
// `createTradingClient(opts)` returns a typed wrapper around the Uniswap
// Trading API at https://trade-api.gateway.uniswap.org/v1. The client does no
// signing — it produces a `SwapTransaction` ready for `signer.execute(...)`
// to consume. Phase 2 wraps this output as the `universalRouterCalldata`
// argument to `TrustSwapRouter.gatedSwap()`.
// ---------------------------------------------------------------------------

export interface TradingClientOptions {
  apiKey: string;
  /** Override the base URL. Defaults to the production gateway. */
  baseUrl?: string;
  /** Optional fetch override (for testing). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://trade-api.gateway.uniswap.org/v1";
const UR_VERSION_HEADER = "x-universal-router-version";
const UR_VERSION = "2.0";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface CheckApprovalInput {
  walletAddress: Address;
  token: Address;
  amount: bigint | string;
  chainId: number;
}

export type QuoteType = "EXACT_INPUT" | "EXACT_OUTPUT";

export type RoutingPreference = "BEST_PRICE" | "FASTEST";

export type Protocol = "V2" | "V3" | "V4" | "UNISWAPX_V2" | "UNISWAPX_V3";

export interface QuoteInput {
  swapper: Address;
  tokenIn: Address;
  tokenOut: Address;
  tokenInChainId: number;
  tokenOutChainId: number;
  amount: bigint | string;
  type?: QuoteType;
  /** Slippage as a percentage, 0–100. Default 0.5 (50 bps). */
  slippageTolerance?: number;
  routingPreference?: RoutingPreference;
  protocols?: Protocol[];
  recipient?: Address;
  deadline?: number;
  /** When true, the API auto-calculates slippage and overrides `slippageTolerance`. */
  autoSlippage?: boolean;
}

export interface SwapInput {
  /** Pass the full quote response — the client spreads it correctly. */
  quote: QuoteResponse;
  /** Permit2 signature (CLASSIC) or order signature (UniswapX). */
  signature?: Hex;
}

export interface SwapStatusInput {
  /** One or more transaction hashes to poll. The Trading API accepts an array. */
  txHashes: Hex[];
  /** Optional chain ID. Defaults to 1 server-side; pass 8453 for Base. */
  chainId?: number;
}

export interface OrderStatusInput {
  /** Single UniswapX order ID. */
  orderId?: string;
  /** Multiple UniswapX order IDs. */
  orderIds?: string[];
  /** Filter by status. Useful when listing without a specific ID. */
  orderStatus?: "open" | "filled" | "cancelled" | "expired" | "error";
  /** Filter by swapper address (the user who signed the order). */
  swapper?: Address;
  limit?: number;
}

export interface SwappableTokensInput {
  chainId: number;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type Routing =
  | "CLASSIC"
  | "DUTCH_V2"
  | "DUTCH_V3"
  | "PRIORITY"
  | "WRAP"
  | "UNWRAP"
  | "BRIDGE"
  | "QUICKROUTE"
  | "DUTCH_LIMIT"
  | "LIMIT_ORDER";

export interface Approval {
  to: Address;
  from: Address;
  data: Hex;
  value: string;
  chainId: number;
}

export interface CheckApprovalResponse {
  approval: Approval | null;
}

export interface ClassicQuote {
  routing: "CLASSIC" | "WRAP" | "UNWRAP";
  quote: {
    input: { token: Address; amount: string };
    output: { token: Address; amount: string };
    slippage: number;
    gasFee: string;
    gasFeeUSD: string;
    gasUseEstimate: string;
    route: unknown[];
  };
  permitData: Record<string, unknown> | null;
  permitTransaction?: Record<string, unknown> | null;
}

export interface DutchOrderOutput {
  token: Address;
  startAmount: string;
  endAmount: string;
  recipient: Address;
}

export interface UniswapXQuote {
  routing: "DUTCH_V2" | "DUTCH_V3" | "PRIORITY";
  quote: {
    orderInfo: {
      input: { token: Address; startAmount: string; endAmount: string };
      outputs: DutchOrderOutput[];
      deadline: number;
      nonce: string;
      reactor?: Address;
      swapper?: Address;
      cosigner?: Address;
      chainId?: number;
    };
    encodedOrder: Hex;
    orderHash: Hex;
  };
  permitData: Record<string, unknown> | null;
  permitTransaction?: Record<string, unknown> | null;
}

export type QuoteResponse = ClassicQuote | UniswapXQuote;

export interface SwapTransaction {
  to: Address;
  from: Address;
  data: Hex;
  value: string;
  chainId: number;
  gasLimit?: string;
}

export interface SwapResponse {
  swap: SwapTransaction;
}

export interface SwapEntry {
  swapType: string;
  /** "PENDING" | "SUCCESS" | "FAILED" | "EXPIRED" | (other API-side values) */
  status: string;
  txHash: Hex;
  swapId: string;
}

export interface SwapStatusResponse {
  requestId: string;
  swaps: SwapEntry[];
}

export interface OrderEntry {
  orderId: string;
  swapper?: Address;
  filler?: Address;
  status: string;
  createdAt?: string;
  filledAt?: string;
}

export interface OrderStatusResponse {
  orders: OrderEntry[];
}

export interface TokenInfo {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  chainId: number;
  logoURI?: string;
}

export interface SwappableTokensResponse {
  tokens: TokenInfo[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TradingApiError extends Error {
  readonly status: number;
  readonly errorCode?: string;
  readonly detail?: string;
  readonly body?: unknown;
  constructor(opts: {
    message: string;
    status: number;
    errorCode?: string;
    detail?: string;
    body?: unknown;
  }) {
    super(opts.message);
    this.name = "TradingApiError";
    this.status = opts.status;
    this.errorCode = opts.errorCode;
    this.detail = opts.detail;
    this.body = opts.body;
  }
}

export class QuoteExpiredError extends TradingApiError {
  constructor(opts: ConstructorParameters<typeof TradingApiError>[0]) {
    super(opts);
    this.name = "QuoteExpiredError";
  }
}
export class SlippageExceededError extends TradingApiError {
  constructor(opts: ConstructorParameters<typeof TradingApiError>[0]) {
    super(opts);
    this.name = "SlippageExceededError";
  }
}
export class InsufficientLiquidityError extends TradingApiError {
  constructor(opts: ConstructorParameters<typeof TradingApiError>[0]) {
    super(opts);
    this.name = "InsufficientLiquidityError";
  }
}
export class RateLimitedError extends TradingApiError {
  constructor(opts: ConstructorParameters<typeof TradingApiError>[0]) {
    super(opts);
    this.name = "RateLimitedError";
  }
}
export class InvalidResponseError extends TradingApiError {
  constructor(opts: ConstructorParameters<typeof TradingApiError>[0]) {
    super(opts);
    this.name = "InvalidResponseError";
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface TradingClient {
  checkApproval(input: CheckApprovalInput): Promise<CheckApprovalResponse>;
  quote(input: QuoteInput): Promise<QuoteResponse>;
  swap(input: SwapInput): Promise<SwapResponse>;
  /** Poll the status of one or more CLASSIC swaps. Hits `GET /swaps`. */
  swapStatus(input: SwapStatusInput): Promise<SwapStatusResponse>;
  /** Poll the status of UniswapX gasless orders. Hits `GET /orders`. */
  orderStatus(input: OrderStatusInput): Promise<OrderStatusResponse>;
  swappableTokens(input: SwappableTokensInput): Promise<SwappableTokensResponse>;
}

export function createTradingClient(opts: TradingClientOptions): TradingClient {
  if (!opts.apiKey) {
    throw new Error("createTradingClient: apiKey is required");
  }
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;

  const baseHeaders = {
    "content-type": "application/json",
    "x-api-key": opts.apiKey,
    [UR_VERSION_HEADER]: UR_VERSION,
  } as const;

  async function request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: baseHeaders,
    };
    if (body !== undefined) init.body = JSON.stringify(body);

    const res = await fetchImpl(url, init);
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      throw new InvalidResponseError({
        message: `Trading API returned non-JSON: ${text.slice(0, 200)}`,
        status: res.status,
        body: text,
      });
    }

    if (!res.ok) throw mapHttpError(res.status, parsed);
    return parsed as T;
  }

  return {
    async checkApproval(input) {
      assertAddress("walletAddress", input.walletAddress);
      assertAddress("token", input.token);
      const body = {
        walletAddress: input.walletAddress,
        token: input.token,
        amount: input.amount.toString(),
        chainId: input.chainId,
      };
      return request<CheckApprovalResponse>("POST", "/check_approval", body);
    },

    async quote(input) {
      assertAddress("swapper", input.swapper);
      assertAddress("tokenIn", input.tokenIn);
      assertAddress("tokenOut", input.tokenOut);
      const body: Record<string, unknown> = {
        swapper: input.swapper,
        tokenIn: input.tokenIn,
        tokenOut: input.tokenOut,
        // Trading API requires chain IDs as strings on /quote.
        tokenInChainId: String(input.tokenInChainId),
        tokenOutChainId: String(input.tokenOutChainId),
        amount: input.amount.toString(),
        type: input.type ?? "EXACT_INPUT",
        slippageTolerance: input.slippageTolerance ?? 0.5,
        routingPreference: input.routingPreference ?? "BEST_PRICE",
      };
      if (input.protocols) body.protocols = input.protocols;
      if (input.recipient) {
        assertAddress("recipient", input.recipient);
        body.recipient = input.recipient;
      }
      if (input.deadline !== undefined) body.deadline = input.deadline;
      if (input.autoSlippage !== undefined) body.autoSlippage = input.autoSlippage;

      const res = await request<QuoteResponse>("POST", "/quote", body);
      validateQuoteResponse(res);
      return res;
    },

    async swap(input) {
      const body = prepareSwapRequest(input.quote, input.signature);
      const res = await request<SwapResponse>("POST", "/swap", body);
      validateSwapResponse(res);
      return res;
    },

    async swapStatus(input) {
      if (!input.txHashes || input.txHashes.length === 0) {
        throw new Error("swapStatus: txHashes must be a non-empty array");
      }
      // The Trading API expects repeated `txHashes=...` query keys, one per
      // hash. URLSearchParams.append produces that shape correctly.
      const params = new URLSearchParams();
      for (const h of input.txHashes) params.append("txHashes", h);
      if (input.chainId !== undefined) {
        params.set("chainId", String(input.chainId));
      }
      return request<SwapStatusResponse>(
        "GET",
        `/swaps?${params.toString()}`,
      );
    },

    async orderStatus(input) {
      if (
        !input.orderId &&
        !input.orderIds?.length &&
        !input.orderStatus &&
        !input.swapper
      ) {
        throw new Error(
          "orderStatus: at least one of orderId, orderIds, orderStatus, or swapper is required",
        );
      }
      const params = new URLSearchParams();
      if (input.orderId) params.set("orderId", input.orderId);
      if (input.orderIds?.length) {
        params.set("orderIds", input.orderIds.join(","));
      }
      if (input.orderStatus) params.set("orderStatus", input.orderStatus);
      if (input.swapper) {
        assertAddress("swapper", input.swapper);
        params.set("swapper", input.swapper);
      }
      if (input.limit !== undefined) params.set("limit", String(input.limit));
      return request<OrderStatusResponse>(
        "GET",
        `/orders?${params.toString()}`,
      );
    },

    async swappableTokens(input) {
      const params = new URLSearchParams();
      params.set("chainId", String(input.chainId));
      return request<SwappableTokensResponse>(
        "GET",
        `/swappable_tokens?${params.toString()}`,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the `/swap` request body. The Trading API expects the quote response
 * spread directly into the body (not wrapped). Strip `permitData` and
 * `permitTransaction` from the spread, then re-add `permitData` only for
 * CLASSIC routes when a Permit2 signature is supplied. UniswapX routes
 * (DUTCH_V2/V3/PRIORITY) reject `permitData` in the body — the order is
 * already encoded in `quote.encodedOrder`.
 */
export function prepareSwapRequest(
  quoteResponse: QuoteResponse,
  signature?: Hex,
): Record<string, unknown> {
  const { permitData, permitTransaction, ...cleanQuote } =
    quoteResponse as Record<string, unknown> & QuoteResponse;
  void permitTransaction;
  const request: Record<string, unknown> = { ...cleanQuote };

  if (isUniswapXQuote(quoteResponse)) {
    if (signature) request.signature = signature;
    return request;
  }

  // CLASSIC: signature + permitData together, or neither.
  if (signature && permitData && typeof permitData === "object") {
    request.signature = signature;
    request.permitData = permitData;
  }
  return request;
}

export function isUniswapXQuote(q: QuoteResponse): q is UniswapXQuote {
  return (
    q.routing === "DUTCH_V2" ||
    q.routing === "DUTCH_V3" ||
    q.routing === "PRIORITY"
  );
}

/**
 * Read the user-facing output amount from a quote, regardless of routing.
 * For UniswapX, returns the auction `startAmount` (best-case fill) — callers
 * that care about worst-case should read `endAmount` themselves.
 */
export function getOutputAmount(q: QuoteResponse): string {
  if (isUniswapXQuote(q)) {
    const out = q.quote.orderInfo.outputs[0];
    if (!out) {
      throw new InvalidResponseError({
        message: "UniswapX quote has no outputs",
        status: 200,
        body: q,
      });
    }
    return out.startAmount;
  }
  return q.quote.output.amount;
}

// ---------------------------------------------------------------------------
// USD valuation
//
// `RiskPolicy.maxAcceptedSize` is denominated in 6-decimal USDC base units
// (i.e. USD × 10^6). Comparing it directly against `amount` in the swap
// token's native base units only lines up when the swap involves USDC; for
// any other tokenIn the comparison is meaningless. `valueInUsdc` converts a
// (token, amount, chainId) triple into USDC base units via a Trading API
// quote, returning the amount unchanged when the token already IS USDC.
// ---------------------------------------------------------------------------

/** USDC contract address per chain. Extend as we expand chain support. */
export const USDC_BY_CHAIN: Record<number, Address> = {
  // Base mainnet
  8453: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  // Ethereum mainnet
  1: "0xA0b86991c6218b36C1D19D4a2e9Eb0cE3606eB48",
};

export function getUsdcAddress(chainId: number): Address {
  const addr = USDC_BY_CHAIN[chainId];
  if (!addr) {
    throw new Error(
      `valueInUsdc: no USDC address registered for chainId ${chainId} — extend USDC_BY_CHAIN`,
    );
  }
  return addr;
}

export interface ValueInUsdcArgs {
  /** Caller's address — Trading API requires `swapper` even for valuation quotes. */
  swapper: Address;
  /** Token to value. */
  token: Address;
  /** Amount of `token` in its native base units. */
  amount: bigint;
  /** Chain on which both `token` and USDC live. */
  chainId: number;
}

/**
 * Convert a (token, amount, chainId) triple into USDC 6-decimal base units.
 *
 * - When `token === USDC[chainId]`: returns `amount` directly (no API call).
 * - Otherwise: fetches a `token → USDC` quote and returns `quote.output.amount`.
 *
 * Used by orchestrate.ts and the oracle Worker to USD-normalize amounts
 * before the `RiskPolicy.maxAcceptedSize` comparison.
 *
 * NB: a UniswapX quote has no `quote.output.amount` field, so we force
 * `routingPreference: "BEST_PRICE"` and (implicitly via API default) get a
 * CLASSIC route for the valuation call. If the API returns UniswapX
 * regardless, we fall back to `getOutputAmount` which handles both shapes.
 */
export async function valueInUsdc(
  client: TradingClient,
  args: ValueInUsdcArgs,
): Promise<bigint> {
  const usdc = getUsdcAddress(args.chainId);
  if (args.token.toLowerCase() === usdc.toLowerCase()) {
    return args.amount;
  }
  if (args.amount === 0n) return 0n;
  const quote = await client.quote({
    swapper: args.swapper,
    tokenIn: args.token,
    tokenOut: usdc,
    tokenInChainId: args.chainId,
    tokenOutChainId: args.chainId,
    amount: args.amount,
    type: "EXACT_INPUT",
  });
  return BigInt(getOutputAmount(quote));
}

function validateQuoteResponse(q: QuoteResponse): void {
  if (!q || typeof q !== "object" || !("routing" in q)) {
    throw new InvalidResponseError({
      message: "quote response missing `routing` field",
      status: 200,
      body: q,
    });
  }
  if (isUniswapXQuote(q)) {
    if (!isHex(q.quote.encodedOrder) || !isHex(q.quote.orderHash)) {
      throw new InvalidResponseError({
        message: "UniswapX quote missing encodedOrder or orderHash",
        status: 200,
        body: q,
      });
    }
  } else {
    const out = q.quote?.output?.amount;
    if (typeof out !== "string" || out.length === 0) {
      throw new InvalidResponseError({
        message: "CLASSIC quote missing quote.output.amount",
        status: 200,
        body: q,
      });
    }
  }
}

function validateSwapResponse(res: SwapResponse): void {
  const swap = res?.swap;
  if (!swap) {
    throw new InvalidResponseError({
      message: "swap response missing `swap` field",
      status: 200,
      body: res,
    });
  }
  if (!swap.data || swap.data === "0x" || !isHex(swap.data)) {
    throw new QuoteExpiredError({
      message: "swap.data empty — quote likely expired, re-fetch /quote",
      status: 200,
      body: res,
    });
  }
  if (!isAddress(swap.to) || !isAddress(swap.from)) {
    throw new InvalidResponseError({
      message: "swap response contains invalid address",
      status: 200,
      body: res,
    });
  }
  if (swap.value === undefined || swap.value === null) {
    throw new InvalidResponseError({
      message: "swap response missing `value` field",
      status: 200,
      body: res,
    });
  }
}

function mapHttpError(status: number, body: unknown): TradingApiError {
  const detail = pluckString(body, "detail") ?? pluckString(body, "message");
  const errorCode = pluckString(body, "errorCode");
  const message = `Trading API ${status}${errorCode ? ` ${errorCode}` : ""}${
    detail ? `: ${detail}` : ""
  }`;
  const opts = { message, status, errorCode, detail, body };

  if (status === 429) return new RateLimitedError(opts);

  // 400 with documented Uniswap errorCode strings — best-effort pattern match.
  const e = (errorCode ?? "").toLowerCase();
  const d = (detail ?? "").toLowerCase();
  if (e.includes("quoteexpired") || d.includes("quote expired")) {
    return new QuoteExpiredError(opts);
  }
  if (e.includes("slippage") || d.includes("slippage")) {
    return new SlippageExceededError(opts);
  }
  if (e.includes("insufficientliquidity") || d.includes("insufficient liquidity")) {
    return new InsufficientLiquidityError(opts);
  }
  return new TradingApiError(opts);
}

function pluckString(body: unknown, key: string): string | undefined {
  if (typeof body === "object" && body !== null && key in body) {
    const v = (body as Record<string, unknown>)[key];
    if (typeof v === "string") return v;
  }
  return undefined;
}

function assertAddress(field: string, value: string): void {
  if (!isAddress(value)) {
    throw new Error(`${field} is not a valid 0x address: ${value}`);
  }
}
