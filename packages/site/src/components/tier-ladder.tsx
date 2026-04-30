/**
 * Tier ladder — landing-page identity element. Five horizontal bars
 * stacked vertically; each ascends in width AND in palette saturation
 * to encode the "trust climb" visually. Each bar is labeled with the
 * tier's cap + fee from PLAN.md's tier table.
 */

const RUNGS = [
  { tier: "none", label: "None", cap: "Not eligible", fee: "—", widthPct: 18, color: "bg-tier-none", text: "text-tier-none" },
  { tier: "registered", label: "Registered", cap: "$50 cap", fee: "1.0% fee", widthPct: 36, color: "bg-tier-registered", text: "text-tier-registered" },
  { tier: "discoverable", label: "Discoverable", cap: "$500 cap", fee: "0.5% fee", widthPct: 54, color: "bg-tier-discoverable", text: "text-tier-discoverable" },
  { tier: "verified", label: "Verified", cap: "$5,000 cap", fee: "0.25% fee", widthPct: 76, color: "bg-tier-verified", text: "text-tier-verified" },
  { tier: "full", label: "Full", cap: "Unbounded", fee: "0% fee", widthPct: 100, color: "bg-tier-full", text: "text-tier-full" },
] as const;

export function TierLadder() {
  return (
    <div className="space-y-3">
      {RUNGS.map((r, i) => (
        <div
          key={r.tier}
          className="grid grid-cols-[110px,1fr,160px] items-center gap-4"
          style={{
            opacity: 0,
            animation: `fade-up 560ms cubic-bezier(0.22, 1, 0.36, 1) ${
              i * 90
            }ms both`,
          }}
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10.5px] tabular text-ink-faint">
              {i}/4
            </span>
            <span
              className={`text-[12.5px] font-medium uppercase tracking-[0.13em] ${r.text}`}
            >
              {r.label}
            </span>
          </div>
          <div className="relative h-2.5">
            <div className="absolute inset-y-0 left-0 right-0 rounded-full bg-paper-subtle" />
            <div
              className={`absolute inset-y-0 left-0 origin-left rounded-full ${r.color}`}
              style={{
                width: `${r.widthPct}%`,
                animation: `ladder-rise 700ms cubic-bezier(0.22, 1, 0.36, 1) ${
                  i * 90 + 100
                }ms both`,
              }}
            />
          </div>
          <div className="flex items-baseline justify-end gap-2 text-[12px]">
            <span className="font-mono tabular text-ink">{r.cap}</span>
            <span className="text-ink-faint">·</span>
            <span className="font-mono tabular text-ink-muted">{r.fee}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
