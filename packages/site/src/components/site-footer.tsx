import { ExternalIcon } from "@/components/ui/icons";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-[color:var(--hairline)] bg-paper">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-10 lg:grid-cols-3 lg:px-8">
        <div className="space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-faint">
            Built on
          </div>
          <div className="text-[13px] text-ink-soft leading-relaxed">
            <span className="font-medium text-ink">Synthesis TRL</span> for
            agent identity, <span className="font-medium text-ink">Uniswap Trading API</span> for
            execution, deployed on{" "}
            <span className="font-medium text-ink">Base mainnet</span>.
          </div>
        </div>
        <div className="space-y-2 lg:col-span-2 lg:text-right">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-faint">
            Live artifacts
          </div>
          <div className="space-y-1 text-[13px] text-ink-soft">
            <FooterLink
              label="TrustSwapRouter"
              value="0x4aFa…BD3a"
              href="https://basescan.org/address/0x4aFa38bC5A775B08826f8644327C0c435fF5BD3a"
            />
            <FooterLink
              label="Oracle (Cloudflare Workers)"
              value="trust-swap-oracle"
              href="https://trust-swap-oracle.estmcmxci.workers.dev/healthz"
            />
            <FooterLink
              label="Reference RiskPolicy"
              value="kernel.emilemarcelagustin.eth"
              href="https://app.ens.domains/kernel.emilemarcelagustin.eth"
            />
          </div>
        </div>
      </div>
      <div className="border-t border-[color:var(--hairline)]">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4 text-[11px] text-ink-faint lg:px-8">
          <span className="font-mono uppercase tracking-[0.18em]">
            phase 4 · screen-share artifact
          </span>
          <span>© trust-swap contributors</span>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-baseline gap-2 transition-colors hover:text-ink lg:justify-end"
    >
      <span className="text-ink-faint">{label}</span>
      <span className="font-mono text-ink">{value}</span>
      <ExternalIcon className="relative top-px h-3 w-3 text-ink-faint" />
    </a>
  );
}
