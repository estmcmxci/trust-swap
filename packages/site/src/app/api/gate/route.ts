import { NextResponse } from "next/server";
import { z } from "zod";
import { isAddress } from "viem";
import {
  cachedResolveTrustProfile,
  defaultSwapPolicy,
  gate,
  resolveRiskPolicyWithProvenance,
  resolveWithSubnameInheritance,
} from "@trust-swap/core";
import type {
  PreviewResponse,
  PreviewErrorResponse,
  RiskPolicySerialized,
} from "@/lib/preview-types";

// ---------------------------------------------------------------------------
// POST /api/gate (TRU-34)
//
// Surfaces what the orchestrate dry-run would tell us *without* doing a full
// orchestrate (no Trading API / oracle round-trip). Three pieces:
//
//   1. Resolve recipient via TRL → trust profile + tier
//   2. Fetch recipient's RiskPolicy at blockTag=finalized
//   3. Apply local `gate()` against `defaultSwapPolicy`. If RiskPolicy is
//      published, surface the static checks (token allow-list, swapper tier
//      vs minCounterpartyTier when callerEns supplied, raw-amount size
//      check) for the UI to render the right diagnostic.
//
// What this DOESN'T do, by design:
//   • USD-normalize the size check (TRU-77 logic) — that requires a
//     Trading API call. Preview compares raw amounts in USDC 6-dec base
//     units. Form caller is expected to convert USD → 6-dec; the route
//     defaults tokenIn=USDC so this is apples-to-apples in the common
//     path.
//   • Hit the oracle. The oracle is the binding signal at attest time;
//     this endpoint is purely diagnostic.
//
// Rate limiting: deferred to a follow-up. Vercel KV / Upstash would be
// the natural backend for production.
// ---------------------------------------------------------------------------

const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WETH_BASE = "0x4200000000000000000000000000000000000006";

const RequestSchema = z.object({
  recipientEns: z.string().min(3),
  callerEns: z.string().min(3).optional(),
  tokenIn: z
    .string()
    .refine((v) => isAddress(v), "tokenIn must be 0x-prefixed address")
    .default(USDC_BASE),
  tokenOut: z
    .string()
    .refine((v) => isAddress(v), "tokenOut must be 0x-prefixed address")
    .default(WETH_BASE),
  amount: z
    .string()
    .regex(/^\d+$/, "amount must be a base-10 integer string (USDC base units)")
    .default("1000000"), // 1 USDC
});

type Tier = "none" | "registered" | "discoverable" | "verified" | "full";
const TIER_RANK: Record<Tier, number> = {
  none: 0,
  registered: 1,
  discoverable: 2,
  verified: 3,
  full: 4,
};

export async function POST(req: Request) {
  let body: z.infer<typeof RequestSchema>;
  try {
    const raw = await req.json();
    body = RequestSchema.parse(raw);
  } catch (err) {
    return jsonError(
      err instanceof z.ZodError
        ? `invalid request: ${err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
        : "invalid JSON body",
      400,
    );
  }

  // 1. Resolve recipient with subname-tier inheritance (matches the
  //    orchestrate + oracle paths). Cache layer absorbs synthesis flakes.
  const ensRpcUrl = process.env.ETH_RPC_URL;
  let recipientProfile;
  try {
    recipientProfile = await resolveWithSubnameInheritance(
      body.recipientEns,
      { ensRpcUrl },
      (ens, ro) => cachedResolveTrustProfile(ens, ro ?? {}),
    );
  } catch (err) {
    return jsonError(
      `recipient resolve failed: ${err instanceof Error ? err.message : "unknown"}`,
      502,
    );
  }

  // 2. Fetch recipient's RiskPolicy at finalized.
  let riskPolicyResolution;
  try {
    riskPolicyResolution = await resolveRiskPolicyWithProvenance(
      body.recipientEns,
      { ensRpcUrl, blockTag: "finalized" },
    );
  } catch (err) {
    return jsonError(
      `risk-policy resolve failed: ${err instanceof Error ? err.message : "unknown"}`,
      502,
    );
  }

  // 2b. Optional swapper resolve when callerEns provided. Best-effort.
  //     Subname-aware so a user calling from a kernel subname inherits.
  let swapperTier: Tier | null = null;
  if (body.callerEns) {
    try {
      const sp = await resolveWithSubnameInheritance(
        body.callerEns,
        { ensRpcUrl },
        (ens, ro) => cachedResolveTrustProfile(ens, ro ?? {}),
      );
      swapperTier = sp.trustScore as Tier;
    } catch {
      // best-effort only
    }
  }

  // 3. Gate decision (router-floor terms). Allow `none` is the only outright
  //    deny in defaultSwapPolicy; everything else passes the floor.
  const decision = gate(recipientProfile, defaultSwapPolicy, body.callerEns);

  // 4. Layer halt logic on top of the gate result. Order matters:
  //    address-unresolved is checked even when the gate allows, because
  //    a recipient with a passing tier but no resolvable address record
  //    can't actually receive a swap. Mirrors the orchestrate path's
  //    `recipient-unresolved` halt (TRU-34 codex P1 #3 on PR #7).
  let haltedAt: string | undefined;
  let onboardingHint: string | undefined;
  if (!decision.allow) {
    haltedAt = "gate-deny";
    onboardingHint = onboardingHintFor(recipientProfile.trustScore);
  } else if (
    !recipientProfile.address ||
    !isAddress(recipientProfile.address)
  ) {
    haltedAt = "recipient-unresolved";
    onboardingHint = `${body.recipientEns} has no resolvable address record. Set the ENS \`addr\` record before the swap can settle.`;
  } else if (riskPolicyResolution.policy) {
    const p = riskPolicyResolution.policy;
    const offered = body.tokenIn.toLowerCase();
    const accepted = p.acceptedTokens.map((t) => t.toLowerCase());
    if (accepted.length > 0 && !accepted.includes(offered)) {
      haltedAt = "risk-policy-deny";
      onboardingHint = `${body.recipientEns} accepts only ${p.acceptedTokens.map(shortAddr).join(", ")}; you offered ${shortAddr(body.tokenIn)}.`;
    } else if (
      swapperTier &&
      TIER_RANK[swapperTier] < TIER_RANK[p.minCounterpartyTier as Tier]
    ) {
      haltedAt = "risk-policy-deny";
      onboardingHint = `${body.recipientEns} requires tier \`${p.minCounterpartyTier}\`+; you're at \`${swapperTier}\`. Resolve via AgentBook → AIP manifest.`;
    } else if (BigInt(body.amount) > p.maxAcceptedSize) {
      haltedAt = "risk-policy-deny";
      const cap = (Number(p.maxAcceptedSize) / 1_000_000).toFixed(2);
      const requested = (Number(body.amount) / 1_000_000).toFixed(2);
      onboardingHint = `${body.recipientEns} caps inbound at ~$${cap}; you requested ~$${requested}. Resubmit with a smaller amount.`;
    }
  }

  // Project to the client-facing shape.
  const response: PreviewResponse = {
    recipientEns: body.recipientEns.toLowerCase(),
    recipientProfile: {
      ensName: recipientProfile.ensName,
      address: recipientProfile.address ?? null,
      trustScore: recipientProfile.trustScore,
      personhood: { verified: recipientProfile.personhood.verified },
      identity: { verified: recipientProfile.identity.verified },
      context: { found: recipientProfile.context.found },
      manifest: {
        found: recipientProfile.manifest.found,
        signatureValid: recipientProfile.manifest.signatureValid,
      },
      skill: { found: recipientProfile.skill.found },
    },
    recipientRiskPolicy: serializePolicy(riskPolicyResolution.policy),
    riskPolicySource: riskPolicyResolution.source,
    gate: { allow: decision.allow, reason: decision.reason },
    haltedAt,
    onboardingHint,
  };
  return NextResponse.json(response);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonError(error: string, status: number) {
  const body: PreviewErrorResponse = { error };
  return NextResponse.json(body, { status });
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function serializePolicy(
  policy: Awaited<
    ReturnType<typeof resolveRiskPolicyWithProvenance>
  >["policy"],
): RiskPolicySerialized | null {
  if (!policy) return null;
  return {
    minCounterpartyTier: policy.minCounterpartyTier,
    maxAcceptedSize: policy.maxAcceptedSize.toString(),
    acceptedTokens: policy.acceptedTokens,
    validUntil: policy.validUntil,
    requiredManifestSig: policy.requiredManifestSig,
  };
}

function onboardingHintFor(tier: Tier): string {
  if (tier === "none") {
    return "Recipient is tier `none` — register on AgentBook for personhood (none → registered) before settling.";
  }
  return `Recipient gate denied at tier \`${tier}\`. Check identity / manifest layer for the missing signal.`;
}
