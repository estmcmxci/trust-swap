import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { TierRibbon } from "@/components/ui/tier-badge";
import { LayerBadges } from "@/components/layer-badges";
import { ExternalIcon } from "@/components/ui/icons";
import { shortAddr } from "@/lib/format";
import type { PreviewResponse } from "@/lib/preview-types";

interface TrustCardProps {
  profile: PreviewResponse["recipientProfile"];
  ensName: string;
}

export function TrustCard({ profile, ensName }: TrustCardProps) {
  return (
    <Card seal>
      <CardHeader
        eyebrow="Recipient"
        meta={<TierRibbon tier={profile.trustScore} />}
      >
        <div className="mt-1.5 flex flex-col gap-1">
          <div className="flex items-baseline gap-3">
            <h3 className="text-[18px] font-semibold tracking-editorial text-ink">
              {ensName}
            </h3>
            {profile.address && (
              <a
                href={`https://app.ens.domains/${ensName}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11.5px] text-ink-faint transition-colors hover:text-brand-500"
              >
                view on ENS <ExternalIcon className="h-3 w-3" />
              </a>
            )}
          </div>
          <div className="font-mono text-[12px] text-ink-muted">
            {profile.address ? shortAddr(profile.address) : "(no address resolved)"}
          </div>
        </div>
      </CardHeader>
      <CardBody>
        <LayerBadges profile={profile} />
      </CardBody>
    </Card>
  );
}
