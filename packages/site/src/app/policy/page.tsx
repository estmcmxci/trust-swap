"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Toggle } from "@/components/ui/field";
import { CodeBlock } from "@/components/ui/code-block";
import { CopyButton } from "@/components/ui/copy-button";
import { TierBadge } from "@/components/ui/tier-badge";
import { StatusPill } from "@/components/ui/status-pill";
import { CheckIcon, SparkleIcon } from "@/components/ui/icons";
import type {
  PolicyDraftErrorResponse,
  PolicyDraftResponse,
  RestrictableTier,
} from "@/lib/policy-types";

const RESTRICTABLE_TIERS: RestrictableTier[] = [
  "registered",
  "discoverable",
  "verified",
  "full",
];
const TOKEN_PRESETS = ["USDC", "WETH", "DAI"] as const;

export default function PolicyPage() {
  const [ensName, setEnsName] = useState("kernel.emilemarcelagustin.eth");
  const [minTier, setMinTier] = useState<RestrictableTier>("registered");
  const [maxUsd, setMaxUsd] = useState("100");
  const [selectedTokens, setSelectedTokens] = useState<string[]>(["USDC"]);
  const [customToken, setCustomToken] = useState("");
  const [requireManifestSig, setRequireManifestSig] = useState(false);
  const [validUntil, setValidUntil] = useState("");

  const [draft, setDraft] = useState<PolicyDraftResponse | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  // Combine selected presets + custom token (if it parses).
  const tokens = useMemo(() => {
    const all = [...selectedTokens];
    if (customToken.trim()) all.push(customToken.trim());
    return all;
  }, [selectedTokens, customToken]);

  // Re-validate the draft on every input change. Debounced lightly to
  // keep the request rate reasonable when the user types.
  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const res = await fetch("/api/policy/draft", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ensName: ensName.trim() || undefined,
            minCounterpartyTier: minTier,
            maxAcceptedSizeUsd: Number(maxUsd) || 0,
            acceptedTokens: tokens,
            requiredManifestSig: requireManifestSig || undefined,
            validUntil: validUntil ? toIso(validUntil) : undefined,
          }),
        });
        const data = (await res.json()) as
          | PolicyDraftResponse
          | PolicyDraftErrorResponse;
        if (cancelled) return;
        if (!res.ok || "error" in data) {
          setRequestError("error" in data ? data.error : `Request failed`);
          setDraft(null);
        } else {
          setRequestError(null);
          setDraft(data);
        }
      } catch (err) {
        if (!cancelled) {
          setRequestError(err instanceof Error ? err.message : "unknown error");
          setDraft(null);
        }
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [ensName, minTier, maxUsd, tokens, requireManifestSig, validUntil]);

  const isValid = draft?.valid === true;
  const inlinePct = draft
    ? Math.min(100, (draft.inlineByteSize / draft.inlineSoftCap) * 100)
    : 0;

  return (
    <div className="space-y-10">
      {/* Page header */}
      <header className="space-y-3">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-ink-faint">
          /policy
        </div>
        <h1 className="text-[32px] font-semibold tracking-editorial text-ink lg:text-[40px]">
          Publish your RiskPolicy.
        </h1>
        <p className="max-w-[640px] text-[14.5px] leading-relaxed text-ink-muted">
          Compose a RiskPolicy in the browser, validate it against the
          schema, then copy the equivalent{" "}
          <span className="font-mono text-[12.5px] text-brand-700">
            tru policy publish
          </span>{" "}
          command and run it locally to write to your{" "}
          <span className="font-mono text-[12.5px] text-brand-700">
            agent-risk-policy
          </span>{" "}
          ENS text record. In-browser broadcast (sign + write tx) lands
          with{" "}
          <a
            href="https://linear.app/trust-swap/issue/TRU-79"
            target="_blank"
            rel="noreferrer"
            className="text-brand-700 underline-offset-2 hover:underline"
          >
            TRU-79
          </a>
          .
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[440px,1fr] lg:gap-10">
        <div className="space-y-5">
          <Card>
            <CardHeader
              eyebrow="Compose"
              title="RiskPolicy editor"
              meta={
                isValid ? (
                  <StatusPill
                    tone="verified"
                    icon={<CheckIcon className="h-3 w-3" />}
                  >
                    valid
                  </StatusPill>
                ) : draft && draft.errors.length > 0 ? (
                  <StatusPill
                    tone="warning"
                    icon={<SparkleIcon className="h-3 w-3" />}
                  >
                    {draft.errors.length} issue
                    {draft.errors.length === 1 ? "" : "s"}
                  </StatusPill>
                ) : (
                  <StatusPill tone="muted">drafting</StatusPill>
                )
              }
            />
            <CardBody className="space-y-5">
              <Field label="ENS name" hint="Where this policy will be published">
                <Input
                  value={ensName}
                  onChange={(e) => setEnsName(e.target.value)}
                  placeholder="alice.eth"
                  mono
                  spellCheck={false}
                  autoComplete="off"
                />
              </Field>

              <div>
                <label className="mb-2 flex items-baseline justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-muted">
                    Min counterparty tier <span className="ml-1 text-gold-500">*</span>
                  </span>
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {RESTRICTABLE_TIERS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setMinTier(t)}
                      className={`rounded-lg border px-2 py-2 text-center transition-all duration-150 ${
                        minTier === t
                          ? "border-brand-500 bg-brand-50 shadow-ring"
                          : "border-[color:var(--hairline)] bg-white hover:bg-paper-subtle"
                      }`}
                    >
                      <div className="flex justify-center">
                        <TierBadge tier={t} size="sm" showRank={false} />
                      </div>
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11.5px] leading-snug text-ink-faint">
                  Only counterparties at this tier or higher will be
                  attested for swaps to your address.
                </p>
              </div>

              <Field
                label="Max accepted size"
                hint="Inbound USD value cap, denominated in USDC base units"
                prefix={<span className="font-mono text-[13px]">$</span>}
                suffix={
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.14em]">
                    USD
                  </span>
                }
                required
              >
                <Input
                  inputMode="decimal"
                  value={maxUsd}
                  onChange={(e) => setMaxUsd(e.target.value)}
                  placeholder="5000"
                  mono
                />
              </Field>

              <div>
                <label className="mb-2 flex items-baseline justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-muted">
                    Accepted tokens
                  </span>
                  <span className="text-[10.5px] text-ink-faint">
                    empty = any token
                  </span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {TOKEN_PRESETS.map((t) => {
                    const on = selectedTokens.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          setSelectedTokens((prev) =>
                            prev.includes(t)
                              ? prev.filter((x) => x !== t)
                              : [...prev, t],
                          );
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-all duration-150 ${
                          on
                            ? "border-brand-500 bg-brand-50 text-brand-700 shadow-ring"
                            : "border-[color:var(--hairline)] bg-white text-ink-soft hover:bg-paper-subtle"
                        }`}
                      >
                        {on && <CheckIcon className="h-3 w-3" />}
                        {t}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2.5">
                  <Field
                    label="Custom address"
                    hint="Optional — append a single 0x token (more via CLI)"
                  >
                    <Input
                      value={customToken}
                      onChange={(e) => setCustomToken(e.target.value)}
                      placeholder="0x…"
                      mono
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </Field>
                </div>
              </div>

              <Toggle
                id="require-manifest-sig"
                checked={requireManifestSig}
                onCheckedChange={setRequireManifestSig}
                label="Require verified manifest signature"
                hint="Counterparty must have a valid signed AIP manifest on their ENS"
              />

              <Field
                label="Valid until"
                hint="Optional — past this date, fetchers treat the policy as absent"
              >
                <Input
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
              </Field>

              {requestError && (
                <div className="rounded-lg border border-gold-100 bg-gold-50/60 px-3.5 py-2.5 text-[12px] text-gold-800">
                  {requestError}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          <DraftBanner draft={draft} ensName={ensName} />
          <SerializedPreview draft={draft} />
          <CliCommand draft={draft} />
        </div>
      </div>
    </div>
  );
}

function DraftBanner({
  draft,
  ensName,
}: {
  draft: PolicyDraftResponse | null;
  ensName: string;
}) {
  if (!draft) {
    return (
      <Card className="border-dashed">
        <CardBody className="text-center text-[13px] text-ink-faint">
          Compose a draft on the left to see the validated payload here.
        </CardBody>
      </Card>
    );
  }
  if (!draft.valid) {
    return (
      <Card accent="amber">
        <CardBody className="space-y-3">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold-100 text-gold-700">
              <SparkleIcon className="h-4 w-4" />
            </span>
            <div>
              <div className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-gold-700">
                Schema validation failed
              </div>
              <div className="mt-1 text-[15px] font-semibold tracking-editorial text-ink">
                {draft.errors.length} issue
                {draft.errors.length === 1 ? "" : "s"} to fix
              </div>
            </div>
          </div>
          <ul className="space-y-1.5 rounded-lg border border-gold-100 bg-gold-50/40 px-4 py-3 text-[12.5px] leading-relaxed text-gold-800">
            {draft.errors.map((err, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-gold-500">·</span>
                <span>{err}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    );
  }
  const target = ensName.trim() || "your ENS";
  return (
    <Card accent="verified">
      <CardBody className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tier-verified/10 text-tier-verified">
            <CheckIcon className="h-4 w-4" />
          </span>
          <div>
            <div className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-tier-verified">
              Schema valid · ready to publish
            </div>
            <div className="mt-1 text-[15px] font-semibold tracking-editorial text-ink">
              This payload will land on {target}.
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[color:var(--hairline)] bg-paper-subtle/60 px-4 py-3 text-[12px]">
          <ByteMeter
            current={draft.inlineByteSize}
            cap={draft.inlineSoftCap}
            needsIpfs={draft.needsIpfs}
          />
          <span className="text-ink-faint">·</span>
          <span className="text-ink-muted">
            Storage:{" "}
            <span className="font-medium text-ink">
              {draft.needsIpfs ? "IPFS pin (via Pinata)" : "inline JSON"}
            </span>
          </span>
        </div>
      </CardBody>
    </Card>
  );
}

function ByteMeter({
  current,
  cap,
  needsIpfs,
}: {
  current: number;
  cap: number;
  needsIpfs: boolean;
}) {
  const pct = Math.min(100, (current / cap) * 100);
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-paper-deep">
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all duration-300 ${
            needsIpfs ? "bg-gold-500" : "bg-tier-verified"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-[11px] tabular text-ink-muted">
        <span className="font-medium text-ink">{current}</span>B / {cap}B
      </span>
    </div>
  );
}

function SerializedPreview({ draft }: { draft: PolicyDraftResponse | null }) {
  if (!draft) return null;
  const json = JSON.stringify(draft.serialized, null, 2);
  return (
    <CodeBlock
      label="agent-risk-policy"
      meta={
        <span className="font-mono tabular">
          ENS text record payload
        </span>
      }
      value={json}
      highlight="json"
    />
  );
}

function CliCommand({ draft }: { draft: PolicyDraftResponse | null }) {
  if (!draft) return null;
  return (
    <Card>
      <CardHeader
        eyebrow="Publish"
        title="Run this from the CLI"
        meta={<CopyButton value={draft.cliCommand} label="Copy command" />}
      />
      <CardBody className="space-y-3">
        <CodeBlock
          value={draft.cliCommand}
          highlight="shell"
          copyable={false}
          className="border-0 bg-paper-subtle/40"
        />
        <p className="text-[12px] leading-relaxed text-ink-muted">
          The CLI handles the wallet bind to your ENS controller key and
          posts the{" "}
          <span className="font-mono text-[11.5px]">setText</span> tx.
          Browser-broadcast lands with{" "}
          <a
            href="https://linear.app/trust-swap/issue/TRU-79"
            target="_blank"
            rel="noreferrer"
            className="text-brand-700 underline-offset-2 hover:underline"
          >
            TRU-79
          </a>
          .
        </p>
      </CardBody>
    </Card>
  );
}

function toIso(date: string): string {
  // <input type="date"> emits YYYY-MM-DD. Convert to ISO at end-of-day UTC.
  const [y, m, d] = date.split("-").map(Number);
  const ms = Date.UTC(y, (m ?? 1) - 1, d ?? 1, 23, 59, 59);
  return new Date(ms).toISOString();
}
