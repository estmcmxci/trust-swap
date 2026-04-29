import { z } from "zod";
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  namehash,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
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
  const result = await resolveRiskPolicyWithProvenance(ensName, options);
  return result.policy;
}

/** Where a successfully-resolved RiskPolicy came from. */
export type RiskPolicyProvenance =
  | "endpoint" // fetched live from `agent-endpoint/policy`
  | "text-record" // decoded from `agent-risk-policy` text record (inline)
  | "ipfs" // text record was `ipfs://CID`, fetched + decoded
  | "absent" // neither endpoint nor text record present
  | "expired"; // resolved but `validUntil` had passed; treat as absent

export interface RiskPolicyResolution {
  policy: RiskPolicy | null;
  source: RiskPolicyProvenance;
}

/**
 * Same priority order as `resolveRiskPolicy`, but also reports which storage
 * source produced the policy. Used by `tru policy show` for the provenance
 * line ("from endpoint override" vs "from text record"); core's hot paths
 * use the simpler `resolveRiskPolicy` and don't care.
 */
export async function resolveRiskPolicyWithProvenance(
  ensName: string,
  options: ResolveRiskPolicyOptions = {},
): Promise<RiskPolicyResolution> {
  const client = options.client ?? createEnsClient(options.ensRpcUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const name = normalizeName(ensName);

  // 1. Endpoint override — fetch from `<endpoint>/policy`
  const endpoint = await safeReadTextRecord(client, name, ENDPOINT_KEY);
  if (endpoint) {
    const policy = await fetchPolicyFromEndpoint(endpoint, fetchImpl);
    if (policy) {
      if (isExpired(policy, now())) return { policy: null, source: "expired" };
      return { policy, source: "endpoint" };
    }
  }

  // 2. Text record — inline JSON or ipfs://CID
  const raw = await safeReadTextRecord(client, name, POLICY_KEY);
  if (raw) {
    const isIpfs =
      raw.trim().startsWith("ipfs://") || /^(Qm|bafy)/.test(raw.trim());
    const policy = await decodePolicyTextRecord(raw);
    if (policy) {
      if (isExpired(policy, now())) return { policy: null, source: "expired" };
      return { policy, source: isIpfs ? "ipfs" : "text-record" };
    }
  }

  // 3. Absent
  return { policy: null, source: "absent" };
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

// ---------------------------------------------------------------------------
// Publisher
//
// Write-side flow — completely separate security profile from the rest of
// the package (needs the user's ENS controller key, which the daemon does
// not have). One-shot operation; not part of any hot path.
//
// TRU-62 ships the type contract; TRU-63 fills in the actual ENS resolver
// `setText` call.
// ---------------------------------------------------------------------------

export type PublishRiskPolicyStorage = "inline" | "ipfs" | "auto";

export interface PublishRiskPolicyOptions {
  /** ENS name to publish on. Caller must control its resolver. */
  ensName: string;
  /** Plain RiskPolicy. Validated against the schema before write. */
  policy: RiskPolicy;
  /**
   * Where to put the serialized policy:
   * - `inline` — JSON string in the text record (capped at ~128 bytes
   *   before ENS resolver gas costs spike)
   * - `ipfs`   — pin to IPFS, store `ipfs://CID` in the text record
   * - `auto`   — inline if it fits; else IPFS
   * Default: `auto`.
   */
  storage?: PublishRiskPolicyStorage;
  /**
   * 0x-prefixed private key controlling the ENS name's resolver records.
   * Required. Loaded from env (`ENS_PRIVATE_KEY`) by the CLI.
   */
  controllerPrivateKey: `0x${string}`;
  /** Mainnet RPC URL for the ENS write. Defaults to `eth.drpc.org`. */
  ensRpcUrl?: string;
  /** Optional Pinata JWT — required if storage resolves to `ipfs`. */
  pinataJwt?: string;
}

export interface PublishRiskPolicyResult {
  /** Tx hash of the `setText` call on the ENS resolver. */
  txHash: `0x${string}`;
  /** What ended up stored in the text record (inline JSON or `ipfs://CID`). */
  recordValue: string;
  storage: "inline" | "ipfs";
}

// Mainnet ENS Registry. Same address since the ENS V1 deployment.
const ENS_REGISTRY: Address = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";

/** Tight slice of the ENS Registry / Resolver ABI we need for `setText`. */
const ENS_REGISTRY_ABI = [
  {
    type: "function",
    stateMutability: "view",
    name: "owner",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "resolver",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
] as const;

const RESOLVER_ABI = [
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "setText",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
] as const;

/**
 * Inline-storage threshold. The mainnet Public Resolver charges per byte
 * stored, and gas costs spike past short strings — IPFS-backed records
 * keep the on-chain footprint tiny (just the `ipfs://CID` pointer).
 */
const INLINE_BYTE_LIMIT = 128;

/**
 * Round-trip-safe JSON serialization for a RiskPolicy. Bigints are
 * stringified so the result survives `JSON.stringify`; the schema's
 * `BigIntFromJson` parser turns them back into bigints on read.
 */
export function serializeRiskPolicy(policy: RiskPolicy): string {
  return JSON.stringify({
    minCounterpartyTier: policy.minCounterpartyTier,
    maxAcceptedSize: policy.maxAcceptedSize.toString(),
    acceptedTokens: policy.acceptedTokens,
    requiredManifestSig: policy.requiredManifestSig,
    validUntil: policy.validUntil,
  });
}

/**
 * Pin a RiskPolicy as JSON to IPFS via Pinata. Returns the bare CID
 * (no `ipfs://` prefix; callers prepend that themselves).
 */
async function pinPolicyToIpfs(
  policy: RiskPolicy,
  pinataJwt: string,
): Promise<string> {
  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${pinataJwt}`,
    },
    body: JSON.stringify({
      pinataContent: JSON.parse(serializeRiskPolicy(policy)),
      pinataMetadata: {
        name: "trust-swap-risk-policy",
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<unreadable>");
    throw new Error(`Pinata pin failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { IpfsHash?: string };
  if (!json.IpfsHash) {
    throw new Error(`Pinata response missing IpfsHash: ${JSON.stringify(json)}`);
  }
  return json.IpfsHash;
}

/**
 * Publish a RiskPolicy to the user's ENS by writing the
 * `agent-risk-policy` text record. Idempotent at the policy level —
 * re-publishing replaces the existing record.
 *
 * Storage strategy:
 *   - `inline` — JSON in the text record. Cheap to read; capped at
 *     ~128 bytes before resolver gas costs sting.
 *   - `ipfs`   — pin to IPFS, store `ipfs://<CID>` in the text record.
 *     Requires `pinataJwt` (Pinata is the only pinning service we
 *     support v1; other JWT-equivalent services would work with the
 *     same fetch shape).
 *   - `auto`   — inline if it fits in `INLINE_BYTE_LIMIT`, else IPFS.
 *
 * Auth: caller passes `controllerPrivateKey` directly. We pre-flight
 * the ENS Registry's `owner(node)` to fail fast with a clear error
 * before paying gas; then `setText` is sent against whatever resolver
 * the registry returns. If the resolver rejects auth (e.g. owner is a
 * smart contract that hasn't approved this EOA), the underlying revert
 * is bubbled up.
 */
export async function publishRiskPolicy(
  options: PublishRiskPolicyOptions,
): Promise<PublishRiskPolicyResult> {
  // 1. Validate the policy against the schema before anything touches RPC.
  RiskPolicySchema.parse(options.policy);

  // 2. Decide storage strategy.
  const json = serializeRiskPolicy(options.policy);
  const storagePref: PublishRiskPolicyStorage = options.storage ?? "auto";
  let recordValue: string;
  let chosenStorage: "inline" | "ipfs";
  if (storagePref === "ipfs" || (storagePref === "auto" && json.length >= INLINE_BYTE_LIMIT)) {
    if (!options.pinataJwt) {
      throw new Error(
        `PINATA_JWT required to publish via IPFS (policy is ${json.length} bytes; inline limit ${INLINE_BYTE_LIMIT}). Pass --storage inline to force inline anyway.`,
      );
    }
    const cid = await pinPolicyToIpfs(options.policy, options.pinataJwt);
    recordValue = `ipfs://${cid}`;
    chosenStorage = "ipfs";
  } else {
    recordValue = json;
    chosenStorage = "inline";
  }

  // 3. Build the wallet + public clients on Ethereum mainnet (where ENS lives).
  const transport = http(options.ensRpcUrl);
  const publicClient = createPublicClient({ chain: mainnet, transport });
  const account = privateKeyToAccount(options.controllerPrivateKey);
  const walletClient = createWalletClient({
    chain: mainnet,
    account,
    transport,
  });

  // 4. Compute namehash + look up the ENS Registry for the resolver.
  const node = namehash(normalizeName(options.ensName));

  let resolverAddress: Address;
  let ensOwner: Address;
  try {
    [resolverAddress, ensOwner] = await Promise.all([
      publicClient.readContract({
        address: ENS_REGISTRY,
        abi: ENS_REGISTRY_ABI,
        functionName: "resolver",
        args: [node],
      }),
      publicClient.readContract({
        address: ENS_REGISTRY,
        abi: ENS_REGISTRY_ABI,
        functionName: "owner",
        args: [node],
      }),
    ]);
  } catch (err) {
    throw new Error(
      `ENS registry lookup failed for ${options.ensName}: ${err instanceof Error ? err.message : "unknown"}`,
    );
  }

  if (resolverAddress === zeroAddress) {
    throw new Error(
      `ENS name ${options.ensName} has no resolver set — set one in the ENS app first.`,
    );
  }

  // 5. Pre-flight: warn loudly if the controller key isn't the ENS owner.
  //    The resolver may still accept (e.g. if the owner approved this EOA
  //    via setApprovalForAll), so we don't hard-fail — just surface it.
  if (
    ensOwner !== zeroAddress &&
    ensOwner.toLowerCase() !== account.address.toLowerCase()
  ) {
    // Best-effort warn; the resolver's auth check is the authoritative gate.
    console.warn(
      `[publishRiskPolicy] controller ${account.address} is not the registry-level owner of ${options.ensName} (owner: ${ensOwner}). Continuing — resolver auth will run on chain.`,
    );
  }

  // 6. Send the setText tx.
  let txHash: Hex;
  try {
    txHash = await walletClient.writeContract({
      address: resolverAddress,
      abi: RESOLVER_ABI,
      functionName: "setText",
      args: [node, "agent-risk-policy", recordValue],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    if (/insufficient funds/i.test(msg)) {
      throw new Error(
        `controller ${account.address} has insufficient ETH for gas on Ethereum mainnet`,
      );
    }
    if (/unauthorized|not authorized|0x[a-f0-9]+/i.test(msg)) {
      throw new Error(
        `resolver at ${resolverAddress} rejected the setText call from ${account.address}. Make sure this key controls ${options.ensName} (owner: ${ensOwner}). Underlying error: ${msg.slice(0, 200)}`,
      );
    }
    throw new Error(`setText failed: ${msg.slice(0, 300)}`);
  }

  return {
    txHash,
    recordValue,
    storage: chosenStorage,
  };
}
