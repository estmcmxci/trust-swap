import { Card, CardBody } from "@/components/ui/card";
import { CheckIcon, SparkleIcon } from "@/components/ui/icons";
import type { PreviewResponse } from "@/lib/preview-types";

interface DecisionBannerProps {
  preview: PreviewResponse;
}

export function DecisionBanner({ preview }: DecisionBannerProps) {
  const allowed = preview.gate.allow && !preview.haltedAt;
  const accent = allowed ? "verified" : "amber";
  return (
    <Card accent={accent} aria-live="polite" role="status">
      <CardBody className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[10.5px] font-medium uppercase tracking-[0.18em]">
              <span
                className={
                  allowed ? "text-tier-verified" : "text-gold-700"
                }
              >
                {allowed ? "Decision · ALLOW" : "Decision · HALT"}
              </span>
              {preview.haltedAt && (
                <>
                  <span className="text-ink-faint">·</span>
                  <span className="font-mono normal-case tracking-normal text-ink-muted">
                    {preview.haltedAt}
                  </span>
                </>
              )}
            </div>
            <h3 className="text-[20px] font-semibold tracking-editorial text-ink">
              {allowed
                ? "Both sides satisfy the policy."
                : "This swap won't pass the policy."}
            </h3>
          </div>
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              allowed
                ? "bg-tier-verified/10 text-tier-verified"
                : "bg-gold-100 text-gold-700"
            }`}
          >
            {allowed ? (
              <CheckIcon className="h-5 w-5" />
            ) : (
              <SparkleIcon className="h-4 w-4" />
            )}
          </div>
        </div>
        {allowed && (
          <div className="rounded-lg border border-[color:var(--hairline)] bg-paper-subtle/60 px-4 py-3 text-[13px] leading-relaxed text-ink-soft">
            All checks pass at the floor + RiskPolicy layer. Run{" "}
            <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[11.5px] text-brand-700 ring-1 ring-[color:var(--hairline)]">
              tru swap {preview.recipientEns}
            </code>{" "}
            from the CLI to broadcast. In-browser settle landing under{" "}
            <a
              href="https://linear.app/trust-swap/issue/TRU-79"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-brand-700 underline-offset-2 hover:underline"
            >
              TRU-79
            </a>
            .
          </div>
        )}
        {!allowed && preview.onboardingHint && (
          <p className="rounded-lg border border-gold-100 bg-gold-50/60 px-4 py-3 text-[13px] leading-relaxed text-gold-800">
            {preview.onboardingHint}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
