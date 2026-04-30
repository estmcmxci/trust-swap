import Link from "next/link";
import { LiveDot } from "@/components/ui/status-pill";

export function SiteHeader() {
  return (
    <header className="border-b border-[color:var(--hairline)] bg-paper/80 backdrop-blur-sm">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6 lg:px-8">
        <Link
          href="/"
          className="group inline-flex items-center gap-2.5"
          aria-label="TrustSwap home"
        >
          <BrandMark />
          <span className="flex items-baseline gap-1 font-medium tracking-editorial text-ink">
            <span>TrustSwap</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
              v1
            </span>
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-[13px]">
          <NavLink href="/swap" label="Swap" />
          <NavLink href="/policy" label="Policy" />
          <a
            href="https://github.com/estmcmxci/trust-swap"
            target="_blank"
            rel="noreferrer"
            className="ml-2 inline-flex h-9 items-center rounded-lg px-3 text-ink-soft transition-colors hover:bg-paper-subtle hover:text-ink"
          >
            GitHub
          </a>
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <LiveDot />
          <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-ink-faint">
            base mainnet
          </span>
        </div>
      </div>
    </header>
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-9 items-center rounded-lg px-3 text-ink-soft transition-colors hover:bg-paper-subtle hover:text-ink"
    >
      {label}
    </Link>
  );
}

function BrandMark() {
  // T·S monogram with the gold dot motif as the connecting tissue.
  return (
    <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500 text-white shadow-[0_4px_10px_-4px_rgba(30,64,175,0.55)]">
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
        <path
          d="M5 7h6M8 7v10"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="12.5" cy="12" r="1.4" fill="#C7942F" />
        <path
          d="M16 8c1.4 0 2.5 1 2.5 2.4 0 1-.6 1.7-1.6 2-1 .3-1.6 1-1.6 2 0 1.4 1.1 2.4 2.5 2.4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </span>
  );
}
