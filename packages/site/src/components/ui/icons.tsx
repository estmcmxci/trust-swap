/**
 * Inline SVG glyphs. Hand-rolled so each one is intentional and the brand
 * stays consistent — no icon-library aesthetic creep. All accept a className
 * for sizing/color via Tailwind `w-*`/`h-*`/`text-*`.
 */
import type { SVGProps } from "react";

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" {...base} {...props}>
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  );
}

export function DotIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" {...props}>
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  );
}

export function CopyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" {...base} {...props}>
      <rect x="5" y="5" width="8" height="8" rx="1.5" />
      <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
    </svg>
  );
}

export function ExternalIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" {...base} {...props}>
      <path d="M9 3h4v4" />
      <path d="M13 3l-7 7" />
      <path d="M11 9v3.5A1.5 1.5 0 0 1 9.5 14h-6A1.5 1.5 0 0 1 2 12.5v-6A1.5 1.5 0 0 1 3.5 5H7" />
    </svg>
  );
}

export function ArrowRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" {...base} {...props}>
      <path d="M3 8h10" />
      <path d="M9 4l4 4-4 4" />
    </svg>
  );
}

export function SparkleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" {...base} {...props}>
      <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M12 4l-2 2M6 10l-2 2" />
    </svg>
  );
}

export function ShieldIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" {...base} {...props}>
      <path d="M8 2l5 2v4.5c0 3-2.2 5.4-5 6-2.8-.6-5-3-5-6V4l5-2z" />
    </svg>
  );
}

export function GearIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" {...base} {...props}>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.4 1.4M11.55 11.55l1.4 1.4M12.95 3.05l-1.4 1.4M4.45 11.55l-1.4 1.4" />
    </svg>
  );
}

export function LinkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" {...base} {...props}>
      <path d="M7 9.5L9.5 7" />
      <path d="M6 4.5l1.5-1.5a3 3 0 0 1 4.2 4.2L10.5 8.4" />
      <path d="M10 11.5l-1.5 1.5a3 3 0 0 1-4.2-4.2L5.5 7.6" />
    </svg>
  );
}

export function StackIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" {...base} {...props}>
      <path d="M8 2L2 5l6 3 6-3-6-3z" />
      <path d="M2 8l6 3 6-3" />
      <path d="M2 11l6 3 6-3" />
    </svg>
  );
}

export function FlowIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" {...base} {...props}>
      <circle cx="3" cy="4" r="1.5" />
      <circle cx="13" cy="4" r="1.5" />
      <circle cx="8" cy="12" r="1.5" />
      <path d="M4 5l3 6M12 5l-3 6" />
    </svg>
  );
}
