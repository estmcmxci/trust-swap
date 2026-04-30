/**
 * Wire types for the `/api/policy/draft` validation endpoint. The /policy
 * page builds a candidate RiskPolicy in the browser; before showing the
 * "copy CLI command" CTA, it POSTs the draft to this endpoint which
 * runs the same `parseRiskPolicy` schema check the on-chain publisher
 * runs. Catches bad input *before* the user spends gas.
 */
import type { TrustTier } from "@synthesis/resolver";

export type RestrictableTier = Exclude<TrustTier, "none">;

export interface PolicyDraftRequest {
  /** ENS name to publish on (just for the CLI command emission). */
  ensName?: string;
  minCounterpartyTier: RestrictableTier;
  /** USD as a positive number (the editor's natural unit). */
  maxAcceptedSizeUsd: number;
  /** Either a 0x-address or a known symbol (USDC, WETH, DAI). */
  acceptedTokens: string[];
  requiredManifestSig?: boolean;
  /** ISO-8601 string. */
  validUntil?: string;
}

export interface PolicyDraftResponse {
  /** True if the draft passed schema validation. */
  valid: boolean;
  /** Validation errors keyed by field path; empty when valid. */
  errors: string[];
  /** Serialized policy ready to copy/paste into a CLI command. */
  serialized: {
    minCounterpartyTier: RestrictableTier;
    /** Base-10 string in 6-dec USDC base units (matches RiskPolicy on-chain). */
    maxAcceptedSize: string;
    acceptedTokens: string[];
    requiredManifestSig?: boolean;
    /** Unix seconds. */
    validUntil?: number;
  };
  /** Number of bytes the inline JSON would consume in the text record. */
  inlineByteSize: number;
  /** ENS resolver soft-cap for inline storage. */
  inlineSoftCap: 128;
  /** True when `inlineByteSize > inlineSoftCap` — pin to IPFS instead. */
  needsIpfs: boolean;
  /** Human-readable string the user can copy as a `tru policy publish` invocation. */
  cliCommand: string;
}

export interface PolicyDraftErrorResponse {
  error: string;
}
