/**
 * Wire types for the `/api/tokens` endpoint. Subset of core's `TokenInfo`
 * plus a curated short-list flag so the client can surface common pairs
 * first without re-implementing ordering logic on every render.
 */

export interface SiteToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  chainId: number;
  logoURI?: string;
  /** True for the curated demo-friendly subset (USDC, WETH, DAI, etc). */
  curated: boolean;
}

export interface TokensResponse {
  /** All swappable tokens for the requested chain. */
  tokens: SiteToken[];
  /** Source: "trading-api" when fresh, "fallback" when API unreachable. */
  source: "trading-api" | "fallback";
  /** Unix seconds when this list was fetched. */
  fetchedAt: number;
}

export interface TokensErrorResponse {
  error: string;
}

/**
 * Curated symbols that should appear first in the picker. These are the
 * common Base-mainnet pairs the demo flows through and what most users
 * recognize at a glance.
 */
export const CURATED_SYMBOLS = ["USDC", "WETH", "ETH", "DAI", "USDT", "cbETH"] as const;
