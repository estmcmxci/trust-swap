import { isAddress, type Address } from "viem";

/**
 * Known token aliases on Base mainnet. Phase 1 ships the minimum set the
 * demo path needs (USDC ↔ WETH); Phase 4 expands via the Trading API's
 * `swappable_tokens` endpoint.
 *
 * For unknown 0x addresses, decimals default to 18. Pass a symbol when
 * trading non-WETH-decimal tokens to avoid a quote mismatch.
 */
const KNOWN_TOKENS: Record<string, { address: Address; decimals: number }> = {
  USDC: { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6 },
  USDBC: { address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", decimals: 6 },
  WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
  ETH: { address: "0x0000000000000000000000000000000000000000", decimals: 18 },
  DAI: { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18 },
};

export interface ResolvedToken {
  address: Address;
  decimals: number;
  /** Symbol if it matched a known alias, else null. */
  symbol: string | null;
}

export function resolveToken(input: string): ResolvedToken {
  const upper = input.toUpperCase();
  if (KNOWN_TOKENS[upper]) {
    return { ...KNOWN_TOKENS[upper], symbol: upper };
  }
  if (isAddress(input)) {
    return { address: input as Address, decimals: 18, symbol: null };
  }
  throw new Error(
    `unknown token "${input}" — pass a known symbol (${Object.keys(KNOWN_TOKENS).join(", ")}) or a 0x address`,
  );
}
