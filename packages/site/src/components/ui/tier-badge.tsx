import type { TrustTier } from "@synthesis/resolver";
import { tierRank } from "@/lib/format";

const TIER_BG: Record<TrustTier, string> = {
  none: "bg-tier-none",
  registered: "bg-tier-registered",
  discoverable: "bg-tier-discoverable",
  verified: "bg-tier-verified",
  full: "bg-tier-full",
};

const TIER_TEXT: Record<TrustTier, string> = {
  none: "text-tier-none",
  registered: "text-tier-registered",
  discoverable: "text-tier-discoverable",
  verified: "text-tier-verified",
  full: "text-tier-full",
};

const TIER_BG_SOFT: Record<TrustTier, string> = {
  none: "bg-[color:rgba(154,161,176,0.10)]",
  registered: "bg-[color:rgba(115,135,168,0.10)]",
  discoverable: "bg-[color:rgba(63,102,200,0.10)]",
  verified: "bg-[color:rgba(31,158,110,0.10)]",
  full: "bg-[color:rgba(199,148,47,0.10)]",
};

interface TierBadgeProps {
  tier: TrustTier;
  /** Show the "n/5" rank ascending indicator. Default true. */
  showRank?: boolean;
  size?: "sm" | "md";
}

export function TierBadge({ tier, showRank = true, size = "md" }: TierBadgeProps) {
  const rank = tierRank(tier);
  const sizeClasses =
    size === "sm" ? "h-6 px-2 gap-1.5 text-[11px]" : "h-7 px-2.5 gap-2 text-[12px]";
  return (
    <span
      className={`inline-flex items-center rounded-full border border-[color:var(--hairline)] ${TIER_BG_SOFT[tier]} ${sizeClasses}`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-1.5 w-1.5 rounded-full ${TIER_BG[tier]}`}
      />
      <span
        className={`font-medium uppercase tracking-[0.14em] ${TIER_TEXT[tier]}`}
      >
        {tier}
      </span>
      {showRank && (
        <span className="font-mono text-[10.5px] tabular text-ink-faint">
          {rank}/4
        </span>
      )}
    </span>
  );
}

/**
 * The "ribbon" variant — wider, used as the primary tier identifier on
 * trust cards. Includes a vertical color bar on the left edge.
 */
export function TierRibbon({ tier }: { tier: TrustTier }) {
  const rank = tierRank(tier);
  return (
    <span
      className={`relative inline-flex items-center overflow-hidden rounded-lg border border-[color:var(--hairline)] ${TIER_BG_SOFT[tier]} pl-3.5 pr-3 py-2`}
    >
      <span
        aria-hidden="true"
        className={`absolute left-0 top-0 h-full w-1 ${TIER_BG[tier]}`}
      />
      <span className="flex items-baseline gap-2.5">
        <span
          className={`text-[13.5px] font-semibold uppercase tracking-[0.14em] ${TIER_TEXT[tier]}`}
        >
          {tier}
        </span>
        <span className="font-mono text-[10.5px] tabular text-ink-faint">
          tier {rank}/4
        </span>
      </span>
    </span>
  );
}
