"use client";

import { useState, type FormEvent } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { TrustCard } from "@/components/trust-card";
import { PolicyCard } from "@/components/policy-card";
import { DecisionBanner } from "@/components/decision-banner";
import { ArrowRightIcon } from "@/components/ui/icons";
import type {
  PreviewErrorResponse,
  PreviewResponse,
} from "@/lib/preview-types";

const DEFAULT_RECIPIENT = "kernel.emilemarcelagustin.eth";
const DEFAULT_AMOUNT_USD = "1";

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
      const usd = Number(amount);
      if (!Number.isFinite(usd) || usd <= 0) {
        setError("Amount must be a positive number");
        return;
      }
      const baseUnits = String(BigInt(Math.round(usd * 1_000_000)));
      const res = await fetch("/api/gate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipientEns: recipientEns.trim(),
          callerEns: callerEns.trim() || undefined,
          amount: baseUnits,
        }),
      });
      const data = (await res.json()) as
        | PreviewResponse
        | PreviewErrorResponse;
      if (!res.ok || "error" in data) {
        setError("error" in data ? data.error : `Request failed: ${res.status}`);
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
    <div className="space-y-10">
      {/* Page header */}
      <header className="space-y-3">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-ink-faint">
          /swap
        </div>
        <h1 className="text-[32px] font-semibold tracking-editorial text-ink lg:text-[40px]">
          Preview a gated swap.
        </h1>
        <p className="max-w-[640px] text-[14.5px] leading-relaxed text-ink-muted">
          Resolve any ENS recipient through the synthesis Trust Resolution
          Layer, fetch their published{" "}
          <span className="font-mono text-[12.5px] text-brand-700">
            agent-risk-policy
          </span>
          , and preview the orchestrator&apos;s gate decision before spending
          a Trading API call. Broadcast happens via{" "}
          <span className="font-mono text-[12.5px] text-brand-700">
            tru swap
          </span>{" "}
          from the CLI for now —{" "}
          <a
            href="https://linear.app/trust-swap/issue/TRU-79"
            target="_blank"
            rel="noreferrer"
            className="text-brand-700 underline-offset-2 hover:underline"
          >
            TRU-79
          </a>{" "}
          tracks in-browser settle.
        </p>
      </header>

      {/* Two-column layout: form on the left, preview on the right (stacks on mobile) */}
      <div className="grid gap-8 lg:grid-cols-[420px,1fr] lg:gap-10">
        <Card className="lg:sticky lg:top-6 lg:self-start">
          <CardHeader
            eyebrow="Compose"
            title="Swap parameters"
            meta={
              <span className="font-mono text-[10.5px] tabular text-ink-faint">
                base · USDC tokenIn
              </span>
            }
          />
          <CardBody>
            <form onSubmit={handleSubmit} className="space-y-5">
              <Field
                label="Recipient ENS"
                hint="Whose policy do you need to satisfy?"
                required
              >
                <Input
                  value={recipientEns}
                  onChange={(e) => setRecipientEns(e.target.value)}
                  placeholder="kernel.emilemarcelagustin.eth"
                  mono
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <Field
                label="Caller ENS"
                hint="Optional — enables swapper-side tier check"
              >
                <Input
                  value={callerEns}
                  onChange={(e) => setCallerEns(e.target.value)}
                  placeholder="emilemarcelagustin.eth"
                  mono
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <Field
                label="Amount"
                hint="Compared against maxAcceptedSize"
                prefix={<span className="font-mono text-[13px]">$</span>}
                suffix={
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.14em]">
                    USD
                  </span>
                }
              >
                <Input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="1.00"
                  mono
                />
              </Field>
              {error && (
                <div className="rounded-lg border border-gold-100 bg-gold-50/60 px-3.5 py-2.5 text-[12px] text-gold-800">
                  {error}
                </div>
              )}
              <Button
                type="submit"
                size="lg"
                loading={loading}
                disabled={!recipientEns.trim()}
                className="w-full"
              >
                Preview gate decision
                {!loading && <ArrowRightIcon className="h-4 w-4" />}
              </Button>
              <p className="text-[11.5px] leading-relaxed text-ink-faint">
                Preview is diagnostic only — it does not call the Trading
                API or the oracle, so size checks compare raw amounts in
                USDC base units. The orchestrator USD-normalizes
                non-USDC <span className="font-mono">tokenIn</span> at
                attest time.
              </p>
            </form>
          </CardBody>
        </Card>

        <div className="space-y-5">
          {!preview && !loading && <EmptyState />}
          {preview && (
            <div className="space-y-5 stagger">
              <TrustCard
                ensName={preview.recipientEns}
                profile={preview.recipientProfile}
              />
              <PolicyCard
                policy={preview.recipientRiskPolicy}
                source={preview.riskPolicySource}
              />
              <DecisionBanner preview={preview} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="border-dashed">
      <CardBody className="space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-paper-subtle text-ink-faint">
          <ArrowRightIcon className="h-5 w-5" />
        </div>
        <div className="space-y-1.5">
          <div className="text-[14.5px] font-medium text-ink">
            Awaiting recipient resolution
          </div>
          <p className="mx-auto max-w-[360px] text-[12.5px] leading-relaxed text-ink-muted">
            Enter a recipient ENS and amount, then preview the gate
            decision. We&apos;ll resolve their trust profile, fetch the
            RiskPolicy, and tell you whether the swap satisfies it.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
