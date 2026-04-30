import type { ReactNode } from "react";

type Tone = "neutral" | "brand" | "verified" | "warning" | "muted";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-paper-subtle text-ink-soft border-[color:var(--hairline)]",
  brand: "bg-brand-50 text-brand-700 border-brand-100",
  verified: "bg-emerald-50 text-tier-verified border-emerald-100",
  warning: "bg-gold-50 text-gold-700 border-gold-100",
  muted: "bg-paper-subtle text-ink-faint border-[color:var(--hairline)]",
};

export function StatusPill({
  tone = "neutral",
  children,
  icon,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-[0.01em] ${TONE_CLASSES[tone]} ${className}`}
    >
      {icon}
      {children}
    </span>
  );
}

export function LiveDot({ tone = "verified" }: { tone?: Tone }) {
  const colorClass: Record<Tone, string> = {
    neutral: "bg-ink-faint",
    brand: "bg-brand-500",
    verified: "bg-tier-verified",
    warning: "bg-gold-500",
    muted: "bg-ink-faint",
  };
  return (
    <span
      aria-hidden="true"
      className={`relative inline-block h-1.5 w-1.5 rounded-full ${colorClass[tone]}`}
    >
      <span
        className={`absolute inset-0 rounded-full ${colorClass[tone]} animate-pulse-soft`}
      />
    </span>
  );
}
