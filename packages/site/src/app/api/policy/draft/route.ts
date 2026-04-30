import { NextResponse } from "next/server";
import { z } from "zod";
import { isAddress } from "viem";
import { parseRiskPolicy, RiskPolicyError } from "@trust-swap/core";
import type {
  PolicyDraftErrorResponse,
  PolicyDraftResponse,
  RestrictableTier,
} from "@/lib/policy-types";

// ---------------------------------------------------------------------------
// POST /api/policy/draft (TRU-71)
//
// Validates a candidate RiskPolicy edited in the browser without spending
// gas. Mirrors the schema check `tru policy publish` runs locally before
// the `setText` tx — so the user gets identical schema-failure messages
// in either path.
//
// Returns:
//   • valid   — schema parsed
//   • errors  — empty when valid, populated with per-field messages otherwise
//   • serialized — the JSON that would land in the agent-risk-policy text record
//   • inlineByteSize — UTF-8 byte count
//   • needsIpfs — true when payload exceeds the resolver soft cap (128B)
//   • cliCommand — copy-paste string for `tru policy publish ...`
// ---------------------------------------------------------------------------

const TOKEN_ALIASES: Record<string, string> = {
  USDC: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  WETH: "0x4200000000000000000000000000000000000006",
  DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
  ETH: "0x0000000000000000000000000000000000000000",
};

const TierEnum = z.enum(["registered", "discoverable", "verified", "full"]);

const RequestSchema = z.object({
  ensName: z.string().min(3).optional(),
  minCounterpartyTier: TierEnum,
  maxAcceptedSizeUsd: z.number().positive().finite(),
  acceptedTokens: z.array(z.string().min(1)).default([]),
  requiredManifestSig: z.boolean().optional(),
  validUntil: z.string().optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof RequestSchema>;
  try {
    const raw = await req.json();
    body = RequestSchema.parse(raw);
  } catch (err) {
    return jsonError(
      err instanceof z.ZodError
        ? `invalid request: ${err.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`
        : "invalid JSON body",
      400,
    );
  }

  // Resolve token aliases → 0x addresses, validate.
  const resolvedTokens: string[] = [];
  const errors: string[] = [];
  for (const t of body.acceptedTokens) {
    const upper = t.toUpperCase();
    const candidate = TOKEN_ALIASES[upper] ?? t;
    if (!isAddress(candidate)) {
      errors.push(`acceptedTokens: "${t}" is not a known symbol or 0x address`);
      continue;
    }
    resolvedTokens.push(candidate);
  }

  // Codex P1 (PR #7): the RiskPolicy schema accepts an empty
  // acceptedTokens array (semantically "any token"), but
  // `tru policy publish` rejects an empty `--tokens` flag with
  //   "--tokens must list at least one symbol or 0x address"
  // (packages/cli/src/commands/policy.ts:55). Surface this as a
  // validation error so the editor never reports a "valid" draft that
  // produces an unrunnable copy-paste command. Resolving the upstream
  // disconnect lives in a separate ticket — for now the editor enforces
  // the stricter CLI rule.
  if (resolvedTokens.length === 0) {
    errors.push(
      "acceptedTokens: must include at least one token (CLI requires --tokens; the on-chain schema allows empty but the publisher does not)",
    );
  }

  // ValidUntil → unix seconds.
  let validUntilSeconds: number | undefined;
  if (body.validUntil) {
    const parsed = Date.parse(body.validUntil);
    if (Number.isNaN(parsed)) {
      errors.push("validUntil: not a valid ISO-8601 timestamp");
    } else {
      validUntilSeconds = Math.floor(parsed / 1000);
    }
  }

  // USD → 6-dec USDC base units.
  const maxAcceptedSize = BigInt(
    Math.round(body.maxAcceptedSizeUsd * 1_000_000),
  );

  // Run the canonical schema check from core. Catches anything our
  // request-shape validation didn't (most importantly: the
  // stricter-only invariant on minCounterpartyTier).
  const candidate = {
    minCounterpartyTier: body.minCounterpartyTier,
    maxAcceptedSize: maxAcceptedSize.toString(),
    acceptedTokens: resolvedTokens,
    ...(body.requiredManifestSig !== undefined && {
      requiredManifestSig: body.requiredManifestSig,
    }),
    ...(validUntilSeconds && { validUntil: validUntilSeconds }),
  };

  if (errors.length === 0) {
    try {
      parseRiskPolicy(candidate);
    } catch (err) {
      if (err instanceof RiskPolicyError) {
        errors.push(err.message);
      } else {
        errors.push(
          err instanceof Error ? err.message : "unknown validation error",
        );
      }
    }
  }

  // Compute the inline JSON byte size — what'd land in the text record.
  const inlineJson = JSON.stringify(candidate);
  const inlineByteSize = new TextEncoder().encode(inlineJson).length;
  const inlineSoftCap = 128 as const;
  const needsIpfs = inlineByteSize > inlineSoftCap;

  // Compose the equivalent CLI invocation.
  const cliCommand = buildCliCommand({
    ensName: body.ensName,
    minTier: body.minCounterpartyTier,
    maxSizeUsd: body.maxAcceptedSizeUsd,
    tokens: body.acceptedTokens,
    requireManifestSig: body.requiredManifestSig === true,
    validUntilIso: body.validUntil,
    storage: needsIpfs ? "ipfs" : "auto",
  });

  const response: PolicyDraftResponse = {
    valid: errors.length === 0,
    errors,
    serialized: {
      minCounterpartyTier: body.minCounterpartyTier as RestrictableTier,
      maxAcceptedSize: maxAcceptedSize.toString(),
      acceptedTokens: resolvedTokens,
      requiredManifestSig: body.requiredManifestSig,
      validUntil: validUntilSeconds,
    },
    inlineByteSize,
    inlineSoftCap,
    needsIpfs,
    cliCommand,
  };
  return NextResponse.json(response);
}

function jsonError(error: string, status: number) {
  const body: PolicyDraftErrorResponse = { error };
  return NextResponse.json(body, { status });
}

function buildCliCommand(args: {
  ensName?: string;
  minTier: RestrictableTier;
  maxSizeUsd: number;
  tokens: string[];
  requireManifestSig: boolean;
  validUntilIso?: string;
  storage: "auto" | "ipfs";
}) {
  // Flag names match the `incur` parser conventions in
  // packages/cli/src/index.ts: kebab-case shows up in --help but ONLY
  // camelCase actually parses. Verified against the CLI's z.object
  // schema (TRU-33 codex P1 #1 on PR #7 — was emitting `--ens` which
  // silently fell through to the env fallback ENS_PRIMARY_NAME).
  const parts = ["tru", "policy", "publish"];
  if (args.ensName) parts.push("--ensName", shellQuote(args.ensName));
  parts.push("--minTier", args.minTier);
  parts.push("--maxSize", String(args.maxSizeUsd));
  // The CLI rejects empty token lists; the route's validation layer
  // already errors out before we'd build a command for an empty list,
  // but guard here too so a bug elsewhere can't ship a bad command.
  if (args.tokens.length > 0)
    parts.push("--tokens", shellQuote(args.tokens.join(",")));
  if (args.requireManifestSig) parts.push("--requireManifestSig");
  if (args.validUntilIso)
    parts.push("--validUntil", shellQuote(args.validUntilIso));
  if (args.storage === "ipfs") parts.push("--storage", "ipfs");
  return parts.join(" ");
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_./:,-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}
