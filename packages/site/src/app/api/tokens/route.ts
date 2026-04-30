import { NextResponse } from "next/server";
import {
  CURATED_SYMBOLS,
  type SiteToken,
  type TokensErrorResponse,
  type TokensResponse,
} from "@/lib/token-types";

// ---------------------------------------------------------------------------
// GET /api/tokens?chainId=8453 (TRU-33)
//
// Hits the Uniswap default token list at tokens.uniswap.org. NOT the
// Trading API's `/swappable_tokens` endpoint — that's actually a
// bridge-routing surface (returns cross-chain destinations *from* a given
// `tokenIn`, not "all tokens on chain X"). The default token list is the
// canonical source of "what tokens does Uniswap recognise on each chain."
//
// We do this server-side so:
//   1. We can cache the response — the token list is stable enough that
//      `revalidate` dedupes repeat hits (1h).
//   2. Future expansion can layer in trust-swap-specific filtering or
//      blocklists without changing client contracts.
//
// Falls back to a hardcoded curated list when the upstream is unreachable
// so the picker never blocks the demo.
// ---------------------------------------------------------------------------

const DEFAULT_CHAIN_ID = 8453; // Base mainnet
const REVALIDATE_SECONDS = 3600; // 1h — Trading API tokens list is stable

// Next 15 requires `revalidate` to be a literal at module-graph time, not
// an identifier. Keep the export here in sync with the constant above.
export const revalidate = 3600;

const FALLBACK_TOKENS: SiteToken[] = [
  {
    address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    chainId: 8453,
    curated: true,
  },
  {
    address: "0x4200000000000000000000000000000000000006",
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    chainId: 8453,
    curated: true,
  },
  {
    address: "0x0000000000000000000000000000000000000000",
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    chainId: 8453,
    curated: true,
  },
  {
    address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    symbol: "DAI",
    name: "Dai Stablecoin",
    decimals: 18,
    chainId: 8453,
    curated: true,
  },
  {
    address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    chainId: 8453,
    curated: true,
  },
  {
    address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
    symbol: "cbETH",
    name: "Coinbase Wrapped Staked ETH",
    decimals: 18,
    chainId: 8453,
    curated: true,
  },
];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const chainId = Number(searchParams.get("chainId") ?? DEFAULT_CHAIN_ID);
  if (!Number.isFinite(chainId) || chainId <= 0) {
    return jsonError("invalid chainId", 400);
  }

  const upstream =
    process.env.TOKEN_LIST_URL ?? "https://tokens.uniswap.org";

  interface UpstreamToken {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    chainId: number;
    logoURI?: string;
  }

  let upstreamTokens: UpstreamToken[] = [];
  try {
    const res = await fetch(upstream, { next: { revalidate: REVALIDATE_SECONDS } });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const data = (await res.json()) as { tokens?: UpstreamToken[] };
    upstreamTokens = Array.isArray(data.tokens) ? data.tokens : [];
  } catch (err) {
    console.warn(
      `[/api/tokens] upstream fetch failed (${upstream}):`,
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json<TokensResponse>(
      {
        tokens: FALLBACK_TOKENS.filter((t) => t.chainId === chainId),
        source: "fallback",
        fetchedAt: Math.floor(Date.now() / 1000),
      },
      { headers: { "Cache-Control": "public, max-age=60" } },
    );
  }

  // Filter to same-chain + dedupe by canonical address.
  const seen = new Set<string>();
  const sameChain = upstreamTokens.filter((t) => {
    if (t.chainId !== chainId) return false;
    const key = t.address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const curated = new Set<string>(
    CURATED_SYMBOLS.map((s) => s.toUpperCase()),
  );
  const tokens: SiteToken[] = sameChain.map((t) => ({
    address: t.address,
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
    chainId: t.chainId,
    logoURI: t.logoURI,
    curated: curated.has(t.symbol.toUpperCase()),
  }));

  // Fold in the curated fallback for any symbols the upstream list may
  // not carry (e.g. WETH is sometimes excluded — wraps native ETH which
  // the picker should still surface). Curated entries take priority on
  // address collision since they're hand-vetted for the demo.
  const haveSymbol = new Set(tokens.map((t) => t.symbol.toUpperCase()));
  for (const f of FALLBACK_TOKENS) {
    if (f.chainId !== chainId) continue;
    if (haveSymbol.has(f.symbol.toUpperCase())) continue;
    tokens.push(f);
  }

  // Sort: curated first (in the order of CURATED_SYMBOLS), then everything
  // else alphabetically by symbol. Caller can re-sort if they need, but
  // this gives "common pairs at the top" out of the box.
  const curatedOrder = new Map(
    CURATED_SYMBOLS.map((s, i) => [s.toUpperCase(), i]),
  );
  tokens.sort((a, b) => {
    const ai = curatedOrder.get(a.symbol.toUpperCase()) ?? Infinity;
    const bi = curatedOrder.get(b.symbol.toUpperCase()) ?? Infinity;
    if (ai !== bi) return ai - bi;
    return a.symbol.localeCompare(b.symbol);
  });

  return NextResponse.json<TokensResponse>(
    {
      tokens,
      source: "trading-api",
      fetchedAt: Math.floor(Date.now() / 1000),
    },
    {
      headers: {
        "Cache-Control": `public, max-age=${REVALIDATE_SECONDS}, stale-while-revalidate=${REVALIDATE_SECONDS * 2}`,
      },
    },
  );
}

function jsonError(error: string, status: number) {
  const body: TokensErrorResponse = { error };
  return NextResponse.json(body, { status });
}
