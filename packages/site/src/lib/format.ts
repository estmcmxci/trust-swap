/**
 * Small formatting utilities shared across pages + components. No external
 * deps; everything inlined so the site bundle stays lean.
 */

export function shortAddr(addr: string | null | undefined): string {
  if (!addr) return "—";
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function formatUsd(baseUnits: string | bigint): string {
  const n = typeof baseUnits === "string" ? BigInt(baseUnits) : baseUnits;
  // 6-dec USDC base units → human dollars.
  const dollars = Number(n) / 1_000_000;
  if (dollars >= 1000) {
    return dollars.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
  }
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

export function tierRank(
  tier: string,
): 0 | 1 | 2 | 3 | 4 {
  switch (tier) {
    case "none":
      return 0;
    case "registered":
      return 1;
    case "discoverable":
      return 2;
    case "verified":
      return 3;
    case "full":
      return 4;
    default:
      return 0;
  }
}
