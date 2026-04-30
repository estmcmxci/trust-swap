import { type HTMLAttributes, forwardRef } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds a vertical color accent on the left edge (used by decision banners). */
  accent?: "brand" | "gold" | "verified" | "amber" | null;
  /** Adds a small gold square in the upper-right — the "verification seal" motif. */
  seal?: boolean;
}

const ACCENT_BG: Record<NonNullable<CardProps["accent"]>, string> = {
  brand: "bg-brand-500",
  gold: "bg-gold-500",
  verified: "bg-tier-verified",
  amber: "bg-gold-400",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className = "", accent = null, seal = false, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`relative overflow-hidden rounded-2xl border border-[color:var(--hairline)] bg-white shadow-card ${className}`}
      {...rest}
    >
      {accent && (
        <span
          aria-hidden="true"
          className={`absolute left-0 top-0 h-full w-1.5 ${ACCENT_BG[accent]}`}
        />
      )}
      {seal && (
        <span
          aria-hidden="true"
          className="absolute right-4 top-4 h-1.5 w-1.5 rounded-[1px] bg-gold-500"
        />
      )}
      {children}
    </div>
  );
});

interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  eyebrow?: string;
  title?: string;
  meta?: React.ReactNode;
}

export function CardHeader({
  eyebrow,
  title,
  meta,
  className = "",
  children,
  ...rest
}: CardHeaderProps) {
  return (
    <div
      className={`flex items-start justify-between gap-4 border-b border-[color:var(--hairline)] px-6 py-5 ${className}`}
      {...rest}
    >
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-ink-faint">
            {eyebrow}
          </div>
        )}
        {title && (
          <div className="mt-1 text-[15px] font-medium text-ink">{title}</div>
        )}
        {children}
      </div>
      {meta && <div className="shrink-0 text-right">{meta}</div>}
    </div>
  );
}

export function CardBody({
  className = "",
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`px-6 py-5 ${className}`} {...rest}>
      {children}
    </div>
  );
}
