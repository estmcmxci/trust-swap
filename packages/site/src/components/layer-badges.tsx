import { CheckIcon, DotIcon } from "@/components/ui/icons";
import type { PreviewResponse } from "@/lib/preview-types";

const LAYERS = [
  { key: "personhood", label: "Personhood" },
  { key: "identity", label: "Identity" },
  { key: "context", label: "Context" },
  { key: "manifest", label: "Manifest" },
  { key: "skill", label: "Skill" },
] as const;

type Profile = PreviewResponse["recipientProfile"];

function isLayerActive(profile: Profile, key: (typeof LAYERS)[number]["key"]) {
  switch (key) {
    case "personhood":
      return profile.personhood.verified;
    case "identity":
      return profile.identity.verified;
    case "context":
      return profile.context.found;
    case "manifest":
      return profile.manifest.found && profile.manifest.signatureValid;
    case "skill":
      return profile.skill.found;
  }
}

export function LayerBadges({ profile }: { profile: Profile }) {
  const activeCount = LAYERS.filter((l) => isLayerActive(profile, l.key)).length;
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-ink-faint">
          Trust layers
        </div>
        <div className="font-mono text-[11px] tabular text-ink-muted">
          <span className="text-ink">{activeCount}</span>
          <span className="text-ink-faint">/{LAYERS.length} verified</span>
        </div>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {LAYERS.map((layer) => {
          const active = isLayerActive(profile, layer.key);
          return (
            <div
              key={layer.key}
              className={`relative flex flex-col items-center gap-2 rounded-xl border p-3 transition-colors ${
                active
                  ? "border-[color:rgba(31,158,110,0.28)] bg-[color:rgba(31,158,110,0.06)]"
                  : "border-[color:var(--hairline)] bg-paper-subtle/40"
              }`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full ${
                  active
                    ? "bg-tier-verified text-white"
                    : "bg-paper-deep text-ink-faint"
                }`}
              >
                {active ? (
                  <CheckIcon className="h-3.5 w-3.5" />
                ) : (
                  <DotIcon className="h-2.5 w-2.5" />
                )}
              </span>
              <span
                className={`text-[10.5px] font-medium uppercase tracking-[0.12em] ${
                  active ? "text-tier-verified" : "text-ink-faint"
                }`}
              >
                {layer.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
