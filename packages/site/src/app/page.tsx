import Link from "next/link";
import { Card, CardBody } from "@/components/ui/card";
import { TierLadder } from "@/components/tier-ladder";
import { ArrowRightIcon, FlowIcon, ShieldIcon, StackIcon } from "@/components/ui/icons";
import { LiveDot, StatusPill } from "@/components/ui/status-pill";

export default function Landing() {
  return (
    <div className="space-y-16 lg:space-y-24">
      {/* Hero */}
      <section className="grid gap-12 lg:grid-cols-[1.15fr,1fr] lg:items-center">
        <div className="space-y-7 stagger">
          <div>
            <StatusPill tone="brand" icon={<LiveDot tone="brand" />}>
              Live on Base mainnet · v1
            </StatusPill>
          </div>
          <h1 className="text-[46px] font-semibold leading-[1.05] tracking-editorial text-ink lg:text-[58px]">
            Reputation-graded
            <br />
            settlement on{" "}
            <span className="relative inline-block">
              Uniswap.
              <span
                aria-hidden="true"
                className="absolute -bottom-1 left-0 h-2 w-full rounded-full bg-gold-200/80"
              />
            </span>
          </h1>
          <p className="max-w-[560px] text-[16px] leading-[1.65] text-ink-muted">
            Every swap routes through{" "}
            <span className="font-mono text-[13.5px] text-brand-700">TrustSwapRouter</span>{" "}
            on Base — an on-chain contract that verifies an off-chain trust
            attestation, applies tier-graded execution terms, and forwards
            to Uniswap&apos;s Universal Router. Each side publishes a{" "}
            <span className="font-mono text-[13.5px] text-brand-700">RiskPolicy</span>{" "}
            on their ENS. The router enforces the intersection.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <Link
              href="/swap"
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-brand-500 px-5 text-[14px] font-medium text-white shadow-[0_8px_22px_-8px_rgba(30,64,175,0.55)] transition-all hover:bg-brand-600 hover:shadow-[0_10px_30px_-8px_rgba(30,64,175,0.55)]"
            >
              Preview a gated swap
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
            <Link
              href="/policy"
              className="inline-flex h-12 items-center gap-2 rounded-xl border border-[color:var(--hairline-strong)] bg-white px-5 text-[14px] font-medium text-ink-soft transition-colors hover:bg-paper-subtle hover:text-ink"
            >
              Publish your RiskPolicy
            </Link>
          </div>
        </div>

        {/* Tier ladder card — the visual identity */}
        <Card className="lg:translate-y-2">
          <CardBody className="space-y-5">
            <div className="flex items-baseline justify-between">
              <div className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-ink-faint">
                Tier ladder
              </div>
              <div className="text-[11px] text-ink-faint">
                stricter-wins join across both sides
              </div>
            </div>
            <TierLadder />
            <div className="flex items-baseline justify-between border-t border-[color:var(--hairline)] pt-4">
              <span className="text-[11px] text-ink-faint">
                Floor enforced on-chain
              </span>
              <a
                href="https://basescan.org/address/0x4aFa38bC5A775B08826f8644327C0c435fF5BD3a"
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[11px] tabular text-brand-700 transition-colors hover:text-brand-500"
              >
                0x4aFa…BD3a
              </a>
            </div>
          </CardBody>
        </Card>
      </section>

      {/* Five primitives */}
      <section className="space-y-8">
        <div className="flex items-end justify-between gap-6">
          <div className="space-y-2">
            <div className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-ink-faint">
              Composition
            </div>
            <h2 className="text-[28px] font-semibold tracking-editorial text-ink">
              Five primitives, each doing one job.
            </h2>
          </div>
          <p className="hidden max-w-[420px] text-[13.5px] leading-relaxed text-ink-muted lg:block">
            None of these are new on their own. The novelty is the seam
            between them — programmable trust as a first-class signal in
            front of an AMM.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <PrimitiveCard
            icon={<StackIcon className="h-4 w-4" />}
            label="Substrate"
            name="Synthesis TRL"
            blurb={"Resolve <ens> to a 5-layer TrustProfile (Personhood · Identity · Context · Manifest · Skill)."}
          />
          <PrimitiveCard
            icon={<ShieldIcon className="h-4 w-4" />}
            label="Off-chain"
            name="TrustSwap Oracle"
            blurb="Re-resolves both sides, checks published RiskPolicies, signs an attestation."
          />
          <PrimitiveCard
            icon={<FlowIcon className="h-4 w-4" />}
            label="On-chain"
            name="TrustSwapRouter"
            blurb="Verifies the oracle signature, looks up tier-bucket terms, forwards to Universal Router."
          />
          <PrimitiveCard
            icon={<StackIcon className="h-4 w-4" />}
            label="Execution"
            name="Uniswap Trading API"
            blurb="Generates optimal swap calldata for the underlying pools."
          />
          <PrimitiveCard
            icon={<ShieldIcon className="h-4 w-4" />}
            label="Identity / preference"
            name="RiskPolicy on ENS"
            blurb={"Each side publishes 'who and what I'll accept' as an agent-risk-policy text record."}
          />
          <PrimitiveCard
            icon={<FlowIcon className="h-4 w-4" />}
            label="Wallet bound"
            name="Session-key signer"
            blurb={"Onchain toCallPolicy pinned to the router; bounded value, frequency, expiry."}
          />
        </div>
      </section>

      {/* Two CTAs */}
      <section className="grid gap-4 md:grid-cols-2">
        <CtaCard
          eyebrow="/swap"
          title="Preview a gated swap"
          body={
            <>
              Resolve any ENS counterparty, fetch their published RiskPolicy
              from the <span className="font-mono">agent-risk-policy</span>{" "}
              text record, and surface the orchestrator&apos;s gate decision.
            </>
          }
          href="/swap"
        />
        <CtaCard
          eyebrow="/policy"
          title="Publish your RiskPolicy"
          body="Compose a RiskPolicy in the editor, validate it against the schema, copy the CLI command. Browser-broadcast comes with TRU-79."
          href="/policy"
        />
      </section>
    </div>
  );
}

function PrimitiveCard({
  icon,
  label,
  name,
  blurb,
}: {
  icon: React.ReactNode;
  label: string;
  name: string;
  blurb: string;
}) {
  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover">
      <CardBody className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-[color:var(--hairline)] bg-paper-subtle text-ink-soft">
            {icon}
          </span>
          <span className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-ink-faint">
            {label}
          </span>
        </div>
        <div className="space-y-1.5">
          <div className="text-[15px] font-semibold tracking-editorial text-ink">
            {name}
          </div>
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            {blurb}
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

function CtaCard({
  eyebrow,
  title,
  body,
  href,
}: {
  eyebrow: string;
  title: string;
  body: React.ReactNode;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-2xl border border-[color:var(--hairline)] bg-white p-7 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover"
    >
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[12px] font-medium uppercase tracking-[0.16em] text-brand-600">
          {eyebrow}
        </span>
        <ArrowRightIcon className="h-4 w-4 text-ink-faint transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand-500" />
      </div>
      <div className="mt-3 text-[19px] font-semibold tracking-editorial text-ink">
        {title}
      </div>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">
        {body}
      </p>
    </Link>
  );
}
