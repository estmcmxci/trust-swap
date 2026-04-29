import { z } from "zod";
import { isAddress, type Address } from "viem";
import type { PublicClient } from "viem";
import {
  TrustTier,
  createEnsClient,
  fetchJsonFromIpfs,
  getTextRecord,
  normalizeName,
} from "@synthesis/resolver";

// ---------------------------------------------------------------------------
// Schema
//
// RiskPolicy is the recipient-side preference signal. The router enforces it
// through the off-chain oracle: at attestation time the oracle fetches both
// sides' policies and refuses to sign if either fails the other's bar.
//
// **Stricter-only invariant.** A published policy can only further restrict
// the router's floor. It cannot loosen — e.g. setting `minCounterpartyTier:
// "none"` would invite gas-griefing and is rejected at parse time.
// ---------------------------------------------------------------------------

const AddressSchema = z
  .string()
  .refine((v) => isAddress(v), "must be a 0x-prefixed 20-byte address")
  .transform((v) => v as Address);

/** Accepts a bigint or a base-10 string (JSON-friendly), normalizes to bigint. */
const BigIntFromJson = z
  .union([z.bigint(), z.string().regex(/^\d+$/, "must be a base-10 integer")])
  .transform((v) => (typeof v === "bigint" ? v : BigInt(v)));

export const RiskPolicySchema = z
  .object({
    minCounterpartyTier: TrustTier,
    maxAcceptedSize: BigIntFromJson,
    acceptedTokens: z.array(AddressSchema),
    requiredManifestSig: z.boolean().optional(),
    /** Unix timestamp in seconds. Optional. */
    validUntil: z.number().int().positive().optional(),
  })
  .refine((p) => p.minCounterpartyTier !== "none", {
    message:
      "RiskPolicy.minCounterpartyTier cannot be 'none' — would loosen router floor (per spec, RiskPolicy may only restrict)",
    path: ["minCounterpartyTier"],
  });

export type RiskPolicy = z.infer<typeof RiskPolicySchema>;

export class RiskPolicyError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "RiskPolicyError";
    this.cause = cause;
  }
}

/**
 * Parse + validate a candidate `RiskPolicy` payload (already JSON-decoded).
 * Wraps Zod errors in `RiskPolicyError` so callers can distinguish schema
 * failures from network failures.
 */
export function parseRiskPolicy(input: unknown): RiskPolicy {
  const result = RiskPolicySchema.safeParse(input);
  if (!result.success) {
    throw new RiskPolicyError(
      `RiskPolicy validation failed: ${result.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
      result.error,
    );
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Resolver
//
// `resolveRiskPolicy(ens)` returns:
//   1. The policy fetched from `<agent-endpoint>/policy` (live override), or
//   2. The policy decoded from the `agent-risk-policy` text record (inline
//      JSON or `ipfs://CID`), or
//   3. `null` if neither is present, the network call fails, or the policy
//      has expired.
//
// A schema-invalid policy throws (`RiskPolicyError`) — that's an authoring
// bug worth surfacing. Network failures fall through silently to keep the
// resolver fail-open at the transport layer.
// ---------------------------------------------------------------------------

const ENDPOINT_KEY = "agent-endpoint";
const POLICY_KEY = "agent-risk-policy";

export interface ResolveRiskPolicyOptions {
  /** Override the ENS RPC URL. Defaults to ETH_RPC_URL or eth.drpc.org. */
  ensRpcUrl?: string;
  /** Pre-built ENS client (avoids recreating one per call). */
  client?: PublicClient;
  /** Override fetch implementation (for testing). */
  fetchImpl?: typeof fetch;
  /** Clock override for `validUntil` expiry checks. Returns seconds. */
  now?: () => number;
}

export async function resolveRiskPolicy(
  ensName: string,
  options: ResolveRiskPolicyOptions = {},
): Promise<RiskPolicy | null> {
  const client = options.client ?? createEnsClient(options.ensRpcUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const name = normalizeName(ensName);

  // 1. Endpoint override — fetch from `<endpoint>/policy`
  const endpoint = await safeReadTextRecord(client, name, ENDPOINT_KEY);
  if (endpoint) {
    const policy = await fetchPolicyFromEndpoint(endpoint, fetchImpl);
    if (policy && !isExpired(policy, now())) return policy;
  }

  // 2. Text record — inline JSON or ipfs://CID
  const raw = await safeReadTextRecord(client, name, POLICY_KEY);
  if (raw) {
    const policy = await decodePolicyTextRecord(raw);
    if (policy && !isExpired(policy, now())) return policy;
  }

  // 3. Absent
  return null;
}

async function fetchPolicyFromEndpoint(
  endpoint: string,
  fetchImpl: typeof fetch,
): Promise<RiskPolicy | null> {
  const url = `${endpoint.replace(/\/+$/, "")}/policy`;
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return null;
  }
  // Schema errors are authoring bugs — surface them; network errors are not.
  return parseRiskPolicy(json);
}

async function decodePolicyTextRecord(
  raw: string,
): Promise<RiskPolicy | null> {
  const trimmed = raw.trim();
  let json: unknown;
  if (trimmed.startsWith("ipfs://") || /^(Qm|bafy)/.test(trimmed)) {
    try {
      json = await fetchJsonFromIpfs(trimmed);
    } catch {
      return null;
    }
  } else {
    try {
      json = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  return parseRiskPolicy(json);
}

function isExpired(p: RiskPolicy, nowSeconds: number): boolean {
  return p.validUntil !== undefined && nowSeconds > p.validUntil;
}

async function safeReadTextRecord(
  client: PublicClient,
  name: string,
  key: string,
): Promise<string | null> {
  try {
    return await getTextRecord(client, name, key);
  } catch {
    return null;
  }
}
