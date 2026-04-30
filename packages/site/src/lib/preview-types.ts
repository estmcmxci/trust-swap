/**
 * Shared types for the `/api/gate` request/response. The route module
 * imports these for its server-side handler; the `/swap` client uses them
 * to type its fetch calls. Kept minimal and JSON-serializable so we don't
 * accidentally leak `bigint` (which `JSON.stringify` chokes on) over the
 * wire — `maxAcceptedSize` is normalized to a base-10 string in transit.
 */
import type { TrustTier } from "@synthesis/resolver";

export interface PreviewRequest {
  recipientEns: string;
  callerEns?: string;
  /** Address; defaults server-side to USDC on Base. */
  tokenIn?: string;
  /** Address; defaults server-side to WETH on Base. */
  tokenOut?: string;
  /** Decimal-string in 6-dec USDC base units (matches RiskPolicy units). */
  amount?: string;
}

export interface RiskPolicySerialized {
  minCounterpartyTier: TrustTier;
  maxAcceptedSize: string; // bigint as base-10 string
  acceptedTokens: string[];
  validUntil?: number;
  requiredManifestSig?: boolean;
}

export interface PreviewResponse {
  /** ENS we resolved. Lowercased. */
  recipientEns: string;
  /** Resolved profile snapshot (subset; address + tier + the 5 layer flags). */
  recipientProfile: {
    ensName: string;
    address: string | null;
    trustScore: TrustTier;
    personhood: { verified: boolean };
    identity: { verified: boolean };
    context: { found: boolean };
    manifest: { found: boolean; signatureValid: boolean };
    skill: { found: boolean };
  };
  /** Recipient's RiskPolicy if published; null otherwise. Provenance attached. */
  recipientRiskPolicy: RiskPolicySerialized | null;
  riskPolicySource: "endpoint" | "text-record" | "ipfs" | "absent" | "expired";
  /** Final gate decision (tier-floor only — the orchestrate dry-run output). */
  gate: {
    allow: boolean;
    reason?: string;
  };
  /** "gate-deny" | "risk-policy-deny" | "recipient-unresolved" | undefined. */
  haltedAt?: string;
  /** Onboarding hint for the user, if a halt fired. */
  onboardingHint?: string;
}

export interface PreviewErrorResponse {
  error: string;
}
