import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { TierBadge } from "@/components/ui/tier-badge";
import { StatusPill } from "@/components/ui/status-pill";
import { formatTimestamp, formatUsd, shortAddr } from "@/lib/format";
import type {
  PreviewResponse,
  RiskPolicySerialized,
} from "@/lib/preview-types";

const SOURCE_LABELS: Record<PreviewResponse["riskPolicySource"], string> = {
  endpoint: "agent-endpoint",
  "text-record": "ENS text record",
  ipfs: "IPFS (via text-record)",
  absent: "no policy published",
  expired: "expired (validUntil past)",
};

const SOURCE_TONE: Record<
  PreviewResponse["riskPolicySource"],
  "verified" | "brand" | "muted" | "warning"
> = {
  endpoint: "brand",
  "text-record": "verified",
  ipfs: "brand",
  absent: "muted",
  expired: "warning",
};

interface PolicyCardProps {
  policy: RiskPolicySerialized | null;
  source: PreviewResponse["riskPolicySource"];
}

export function PolicyCard({ policy, source }: PolicyCardProps) {
  return (
    <Card>
      <CardHeader
        eyebrow="RiskPolicy"
        title={policy ? "Recipient preferences" : "No published policy"}
        meta={
          <StatusPill tone={SOURCE_TONE[source]}>
            from {SOURCE_LABELS[source]}
          </StatusPill>
        }
      />
      <CardBody>
        {policy ? (
          <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
            <Detail term="Min counterparty tier">
              <TierBadge
                tier={policy.minCounterpartyTier}
                size="sm"
                showRank={false}
              />
            </Detail>
            <Detail term="Max accepted size">
              <span className="font-mono text-[14px] tabular text-ink">
                {formatUsd(policy.maxAcceptedSize)}
              </span>
              <span className="ml-1.5 text-[11px] text-ink-faint">
                inbound to recipient
              </span>
            </Detail>
            <Detail
              term={
                <>
                  Accepted tokens
                  {policy.acceptedTokens.length > 0 && (
                    <span className="ml-2 font-mono text-[10.5px] text-ink-faint">
                      {policy.acceptedTokens.length}
                    </span>
                  )}
                </>
              }
            >
              {policy.acceptedTokens.length === 0 ? (
                <span className="text-[13px] text-ink-faint">any token</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {policy.acceptedTokens.map((addr) => (
                    <a
                      key={addr}
                      href={`https://basescan.org/address/${addr}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border border-[color:var(--hairline)] bg-paper-subtle px-2 py-0.5 font-mono text-[11px] tabular text-ink-soft transition-colors hover:border-brand-200 hover:text-brand-700"
                    >
                      {shortAddr(addr)}
                    </a>
                  ))}
                </div>
              )}
            </Detail>
            <Detail term="Manifest signature required">
              <span
                className={
                  policy.requiredManifestSig
                    ? "text-tier-verified text-[13px] font-medium"
                    : "text-ink-faint text-[13px]"
                }
              >
                {policy.requiredManifestSig ? "Yes" : "No"}
              </span>
            </Detail>
            {policy.validUntil && (
              <Detail term="Valid until" wide>
                <span className="font-mono text-[12.5px] tabular text-ink">
                  {formatTimestamp(policy.validUntil)}
                </span>
              </Detail>
            )}
          </dl>
        ) : (
          <p className="text-[13.5px] leading-relaxed text-ink-muted">
            The recipient has not published a RiskPolicy. The router&apos;s
            tier-bucketed floor is the only counterparty constraint, and the
            recipient accepts whatever tokens + amounts the router allows
            for their tier.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function Detail({
  term,
  wide = false,
  children,
}: {
  term: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-ink-faint">
        {term}
      </dt>
      <dd className="mt-1.5 flex flex-wrap items-baseline gap-1">{children}</dd>
    </div>
  );
}
