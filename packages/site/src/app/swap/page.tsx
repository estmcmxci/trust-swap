"use client";

import { useState, type FormEvent } from "react";
import type {
  PreviewErrorResponse,
  PreviewResponse,
  RiskPolicySerialized,
} from "@/lib/preview-types";

const DEFAULT_RECIPIENT = "kernel.emilemarcelagustin.eth";
const DEFAULT_AMOUNT_USD = "1"; // human dollars; converted to 6-dec base units below

const TIER_BG: Record<string, string> = {
  none: "bg-tier-none",
  registered: "bg-tier-registered",
  discoverable: "bg-tier-discoverable",
  verified: "bg-tier-verified",
  full: "bg-tier-full",
};

const TIER_LABEL: Record<string, string> = {
  none: "tier none",
  registered: "registered",
  discoverable: "discoverable",
  verified: "verified",
  full: "full",
};

export default function SwapPage() {
  const [recipientEns, setRecipientEns] = useState(DEFAULT_RECIPIENT);
  const [amount, setAmount] = useState(DEFAULT_AMOUNT_USD);
  const [callerEns, setCallerEns] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const res = await fetch("/api/gate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipientEns: recipientEns.trim(),
          callerEns: callerEns.trim() || undefined,
          // human dollars → USDC 6-dec base units
          amount: String(BigInt(Math.round(Number(amount) * 1_000_000))),
        }),
      });
      const data = (await res.json()) as
        | PreviewResponse
        | PreviewErrorResponse;
      if (!res.ok || "error" in data) {
        setError("error" in data ? data.error : `${res.status}`);
        return;
      }
      setPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">/swap</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Resolve a recipient ENS through the synthesis Trust Resolution
          Layer, fetch their published RiskPolicy from
          <code className="mx-1 rounded bg-zinc-900 px-1 text-xs">
            agent-risk-policy
          </code>
          ENS text record, and preview the orchestrator&apos;s gate decision.
          The actual broadcast happens via{" "}
          <code className="rounded bg-zinc-900 px-1 text-xs">tru swap</code>{" "}
          from the CLI — in-browser settle is{" "}
          <a
            href="https://linear.app/trust-swap/issue/TRU-79"
            className="underline hover:text-zinc-300"
            target="_blank"
            rel="noreferrer"
          >
            TRU-79
          </a>
          .
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="grid gap-4 rounded-md border border-zinc-800 bg-zinc-900/30 p-6 sm:grid-cols-2"
      >
        <Field label="Recipient ENS" hint="Whose policy do you want to satisfy?">
          <input
            type="text"
            value={recipientEns}
            onChange={(e) => setRecipientEns(e.target.value)}
            className="input"
            placeholder="kernel.emilemarcelagustin.eth"
          />
        </Field>
        <Field
          label="Your ENS (optional)"
          hint="Used for swapper-side tier check"
        >
          <input
            type="text"
            value={callerEns}
            onChange={(e) => setCallerEns(e.target.value)}
            className="input"
            placeholder="emilemarcelagustin.eth"
          />
        </Field>
        <Field label="Amount (USD)" hint="Compared against maxAcceptedSize">
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input"
            placeholder="1.00"
          />
        </Field>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={loading || !recipientEns.trim()}
            className="w-full rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500"
          >
            {loading ? "resolving…" : "Preview gate decision"}
          </button>
        </div>
      </form>

      {error && (
        <div className="rounded-md border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-300">
          <strong className="font-medium">Error: </strong>
          {error}
        </div>
      )}

      {preview && <PreviewBlock preview={preview} />}

      <style jsx>{`
        .input {
          @apply w-full rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-zinc-600 focus:outline-none;
        }
      `}</style>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      {children}
      <span className="block text-xs text-zinc-600">{hint}</span>
    </label>
  );
}

function PreviewBlock({ preview }: { preview: PreviewResponse }) {
  const allowed = preview.gate.allow && !preview.haltedAt;
  return (
    <section className="space-y-6">
      {/* Trust card */}
      <TrustCard preview={preview} />
      {/* RiskPolicy */}
      <PolicyCard
        policy={preview.recipientRiskPolicy}
        source={preview.riskPolicySource}
      />
      {/* Decision */}
      <div
        className={`rounded-md border p-6 ${
          allowed
            ? "border-emerald-900/50 bg-emerald-950/20"
            : "border-amber-900/50 bg-amber-950/20"
        }`}
      >
        <div className="flex items-center gap-3">
          <span
            className={`inline-block h-3 w-3 rounded-full ${
              allowed ? "bg-emerald-500" : "bg-amber-500"
            }`}
          />
          <div className="text-lg font-medium">
            {allowed ? "ALLOW" : "HALT"}{" "}
            {preview.haltedAt && (
              <span className="text-sm text-zinc-400">
                · {preview.haltedAt}
              </span>
            )}
          </div>
        </div>
        {!allowed && preview.onboardingHint && (
          <p className="mt-3 text-sm text-zinc-300">
            {preview.onboardingHint}
          </p>
        )}
        {allowed && (
          <p className="mt-3 text-sm text-zinc-400">
            All checks passed. To broadcast: run{" "}
            <code className="rounded bg-zinc-900 px-1 text-xs">
              tru swap {preview.recipientEns}
            </code>{" "}
            from the CLI. (In-browser settle landing under{" "}
            <a
              className="underline"
              href="https://linear.app/trust-swap/issue/TRU-79"
              target="_blank"
              rel="noreferrer"
            >
              TRU-79
            </a>
            .)
          </p>
        )}
      </div>
    </section>
  );
}

function TrustCard({ preview }: { preview: PreviewResponse }) {
  const p = preview.recipientProfile;
  const tier = p.trustScore;
  return (
    <section className="rounded-md border border-zinc-800 bg-zinc-900/30 p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500">
            recipient
          </div>
          <div className="mt-1 text-lg font-medium">{p.ensName}</div>
          <div className="mt-0.5 text-xs text-zinc-500">
            {p.address ? p.address : "(no address resolved)"}
          </div>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wider text-zinc-50 ${
            TIER_BG[tier] ?? "bg-zinc-700"
          }`}
        >
          {TIER_LABEL[tier]}
        </span>
      </div>
      <div className="mt-5 grid grid-cols-5 gap-2 text-center text-xs">
        <LayerBadge label="personhood" on={p.personhood.verified} />
        <LayerBadge label="identity" on={p.identity.verified} />
        <LayerBadge label="context" on={p.context.found} />
        <LayerBadge
          label="manifest"
          on={p.manifest.found && p.manifest.signatureValid}
        />
        <LayerBadge label="skill" on={p.skill.found} />
      </div>
    </section>
  );
}

function LayerBadge({ label, on }: { label: string; on: boolean }) {
  return (
    <div
      className={`rounded border px-2 py-2 ${
        on
          ? "border-emerald-800 bg-emerald-950/30 text-emerald-300"
          : "border-zinc-800 bg-zinc-950 text-zinc-600"
      }`}
    >
      <div className="text-xs">{label}</div>
      <div className="mt-1 text-base">{on ? "✓" : "·"}</div>
    </div>
  );
}

function PolicyCard({
  policy,
  source,
}: {
  policy: RiskPolicySerialized | null;
  source: PreviewResponse["riskPolicySource"];
}) {
  return (
    <section className="rounded-md border border-zinc-800 bg-zinc-900/30 p-6">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-zinc-500">
          RiskPolicy
        </div>
        <div className="text-xs text-zinc-500">
          source: <span className="text-zinc-300">{source}</span>
        </div>
      </div>
      {policy ? (
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <Detail
            term="min counterparty tier"
            value={policy.minCounterpartyTier}
          />
          <Detail
            term="max accepted size"
            value={`$${(Number(policy.maxAcceptedSize) / 1_000_000).toFixed(2)}`}
          />
          <Detail
            term="accepted tokens"
            value={
              policy.acceptedTokens.length === 0
                ? "any"
                : policy.acceptedTokens
                    .map((a) => `${a.slice(0, 6)}…${a.slice(-4)}`)
                    .join(", ")
            }
          />
          <Detail
            term="manifest sig required"
            value={policy.requiredManifestSig ? "yes" : "no"}
          />
          {policy.validUntil && (
            <Detail
              term="valid until"
              value={new Date(policy.validUntil * 1000).toISOString()}
            />
          )}
        </dl>
      ) : (
        <p className="mt-4 text-sm text-zinc-400">
          No published policy. The router&apos;s tier-bucketed floor is the
          only constraint on the recipient side.
        </p>
      )}
    </section>
  );
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-zinc-500">
        {term}
      </dt>
      <dd className="mt-0.5 text-zinc-200">{value}</dd>
    </div>
  );
}
