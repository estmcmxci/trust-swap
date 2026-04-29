import { encodeFunctionData, isAddress, type Address, type Hex } from "viem";
import {
  createEnsClient,
  gate,
  resolve,
  resolveAddress,
  type GateDecision,
  type ResolveOptions,
  type Signer,
  type TrustPolicy,
  type TrustProfile,
} from "@synthesis/resolver";
import type { TrustTier } from "@synthesis/resolver";
import type {
  AttestRequest,
  AttestResponse,
  Attestation,
} from "./attestation.js";
import { defaultSwapPolicy, tierBucket } from "./policy.js";
import { resolveRiskPolicy, type RiskPolicy } from "./risk-policy.js";
import type {
  QuoteResponse,
  SwapTransaction,
  TradingClient,
} from "./trading.js";

// ---------------------------------------------------------------------------
// Oracle client interface
//
// The oracle service exposes `POST /attest`. Phase 1 uses a mock; Phase 2
// switches to `createHttpOracleClient(ORACLE_URL)`. Both implement the same
// `OracleClient` interface so call sites don't change.
// ---------------------------------------------------------------------------

export interface OracleClient {
  attest(req: AttestRequest): Promise<AttestResponse>;
}

export class OracleRefusalError extends Error {
  readonly hint?: string;
  constructor(reason: string, hint?: string) {
    super(reason);
    this.name = "OracleRefusalError";
    this.hint = hint;
  }
}

export interface CreateMockOracleClientOptions {
  /** Tier the mock will report for the swapper. Default: "verified". */
  swapperTier?: TrustTier;
  /** Tier the mock will report for the recipient. Default: "verified". */
  recipientTier?: TrustTier;
  /** When set, every `attest()` call throws `OracleRefusalError(reason, hint)`. */
  refuse?: { reason: string; hint?: string };
  /** Override the placeholder signature returned by the mock. */
  signature?: Hex;
  /** Deterministic clock — Unix seconds. */
  now?: () => number;
}

const PLACEHOLDER_SIG: Hex = `0x${"00".repeat(65)}` as Hex;

export function createMockOracleClient(
  opts: CreateMockOracleClientOptions = {},
): OracleClient {
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  return {
    async attest(req) {
      if (opts.refuse) {
        throw new OracleRefusalError(opts.refuse.reason, opts.refuse.hint);
      }
      return {
        attestation: {
          swapper: req.swapper,
          recipient: req.recipient,
          swapperTier: opts.swapperTier ?? "verified",
          recipientTier: opts.recipientTier ?? "verified",
          expiresAt: now() + 300,
          nonce: Math.floor(Math.random() * 0xffffffff),
        },
        signature: opts.signature ?? PLACEHOLDER_SIG,
      };
    },
  };
}

export interface CreateHttpOracleClientOptions {
  url: string;
  fetchImpl?: typeof fetch;
}

export function createHttpOracleClient(
  opts: CreateHttpOracleClientOptions,
): OracleClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.url.replace(/\/+$/, "");
  return {
    async attest(req) {
      const res = await fetchImpl(`${base}/attest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      });
      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = text.length > 0 ? JSON.parse(text) : undefined;
      } catch {
        throw new Error(`oracle returned non-JSON: ${text.slice(0, 200)}`);
      }
      if (!res.ok) {
        const body = parsed as { error?: string; hint?: string } | undefined;
        if (res.status === 403 || res.status === 422) {
          throw new OracleRefusalError(
            body?.error ?? `oracle refused (${res.status})`,
            body?.hint,
          );
        }
        throw new Error(`oracle ${res.status}: ${body?.error ?? text}`);
      }
      return parsed as AttestResponse;
    },
  };
}

// ---------------------------------------------------------------------------
// gatedSwap calldata encoding
//
// The Phase 2 `TrustSwapRouter.gatedSwap(bytes,Attestation,bytes)` ABI is
// stable enough to encode against now — only the deployed address changes.
// orchestrate produces the calldata that gets passed to `signer.execute()`.
// ---------------------------------------------------------------------------

const GATED_SWAP_ABI = [
  {
    type: "function",
    name: "gatedSwap",
    stateMutability: "payable",
    inputs: [
      { name: "universalRouterCalldata", type: "bytes" },
      {
        name: "attestation",
        type: "tuple",
        components: [
          { name: "swapper", type: "address" },
          { name: "recipient", type: "address" },
          { name: "swapperTier", type: "uint8" },
          { name: "recipientTier", type: "uint8" },
          { name: "expiresAt", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
      },
      { name: "oracleSig", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

/** Solidity enum order — must match `TrustSwapRouter.TrustTier`. */
const TIER_INDEX: Record<TrustTier, number> = {
  none: 0,
  registered: 1,
  discoverable: 2,
  verified: 3,
  full: 4,
};

export function buildGatedSwapCalldata(args: {
  universalRouterCalldata: Hex;
  attestation: Attestation;
  oracleSig: Hex;
}): Hex {
  return encodeFunctionData({
    abi: GATED_SWAP_ABI,
    functionName: "gatedSwap",
    args: [
      args.universalRouterCalldata,
      {
        swapper: args.attestation.swapper,
        recipient: args.attestation.recipient,
        swapperTier: TIER_INDEX[args.attestation.swapperTier],
        recipientTier: TIER_INDEX[args.attestation.recipientTier],
        expiresAt: BigInt(args.attestation.expiresAt),
        nonce: BigInt(args.attestation.nonce),
      },
      args.oracleSig,
    ],
  });
}

/**
 * Phase 1 placeholder. The actual address is mined via CREATE2 and committed
 * in Phase 2 (TRU-50 / TRU-57). Until then, calldata is built against this
 * sentinel and *not broadcast* — the CLI runs `--dry-run` only.
 */
export const PLACEHOLDER_ROUTER_ADDRESS: Address =
  "0x0000000000000000000000000000000000000000";

const SYNTHETIC_TXHASH: Hex = `0x${"00".repeat(32)}` as Hex;

// ---------------------------------------------------------------------------
// orchestrate
// ---------------------------------------------------------------------------

export type HaltReason =
  | "gate-deny"
  | "recipient-unresolved"
  | "oracle-refusal"
  | "quote-failed"
  | "swap-failed";

export interface ClampApplied {
  reason: string;
  original: bigint;
  clamped: bigint;
}

export interface OrchestrateOptions {
  /** ENS name of the recipient counterparty. Resolved via TRL. */
  recipientEns: string;
  tokenIn: Address;
  tokenOut: Address;
  amount: bigint;
  signer: Signer;
  /** Caller's ENS — required when `policy.allowSelf` is false. */
  callerEns?: string;
  /** Off-chain Trading API client (factory'd in trading.ts). */
  tradingClient: TradingClient;
  /** Mocked or HTTP oracle client. */
  oracleClient: OracleClient;
  /** Default 8453 (Base mainnet). */
  chainId?: number;
  /** Override the gate policy. Defaults to `defaultSwapPolicy`. */
  policy?: TrustPolicy;
  /** Address of the deployed `TrustSwapRouter`. Phase 1 uses placeholder. */
  routerAddress?: Address;
  /**
   * When true, skip `signer.execute(...)` and return `txHash` as the synthetic
   * sentinel. Used by `tru swap --dry-run` (default in Phase 1).
   */
  dryRun?: boolean;
  /** Resolver injection — for testing. Defaults to `@synthesis/resolver.resolve`. */
  resolveTrustProfile?: (
    ensName: string,
    options?: ResolveOptions,
  ) => Promise<TrustProfile>;
  /** RiskPolicy resolver injection — for testing. */
  resolveRiskPolicyFn?: typeof resolveRiskPolicy;
  /** Resolver options forwarded to the TRL resolve call. */
  resolveOptions?: ResolveOptions;
}

export interface OrchestrateResult {
  decision: GateDecision;
  recipientProfile: TrustProfile;
  recipientRiskPolicy: RiskPolicy | null;
  attestation?: Attestation;
  attestationSignature?: Hex;
  quote?: QuoteResponse;
  swapTransaction?: SwapTransaction;
  routerCalldata?: Hex;
  txHash?: Hex;
  clampApplied?: ClampApplied;
  onboardingHint?: string;
  /** The step at which the pipeline halted (if it halted). */
  haltedAt?: HaltReason;
}

export async function orchestrate(
  opts: OrchestrateOptions,
): Promise<OrchestrateResult> {
  const chainId = opts.chainId ?? 8453;
  const policy = opts.policy ?? defaultSwapPolicy;
  const routerAddress = opts.routerAddress ?? PLACEHOLDER_ROUTER_ADDRESS;
  const resolveTP = opts.resolveTrustProfile ?? resolve;
  const resolveRP = opts.resolveRiskPolicyFn ?? resolveRiskPolicy;
  const dryRun = opts.dryRun ?? false; // Phase 2 default: broadcast (router live)

  // Refuse to broadcast against the placeholder. Without this, a caller who
  // forgets to pass `routerAddress` while flipping `dryRun: false` would send
  // a real transaction to 0x000…000 — burning any attached native value
  // (e.g. ETH input swaps) with no recovery path. Phase 2 deploys the real
  // router and callers must thread the deployed address through explicitly.
  if (!dryRun && routerAddress === PLACEHOLDER_ROUTER_ADDRESS) {
    throw new Error(
      "orchestrate: refusing to broadcast — `routerAddress` is required when `dryRun` is false. " +
        "Phase 2's `TrustSwapRouter` deploy address must be passed explicitly.",
    );
  }

  // 1. Resolve the recipient through TRL. If the recipient is a subname
  //    (3+ labels) and resolves tier=none, walk up one level and inherit
  //    the parent's profile — same semantics as the oracle. Subname
  //    creation is gated by parent ownership on ENS, so an existing
  //    subname is implicit delegation from the parent.
  const recipientProfile = await resolveWithSubnameInheritance(
    opts.recipientEns,
    opts.resolveOptions,
    resolveTP,
  );

  // 2. Fetch the recipient's RiskPolicy (may be null).
  const recipientRiskPolicy = await resolveRP(opts.recipientEns);

  // 3. Local pre-flight `gate()` — produces an early diagnostic. The oracle
  //    is the on-chain authority, but stopping here saves a Trading API
  //    round trip when the gate would deny anyway.
  const decision = gate(recipientProfile, policy, opts.callerEns);
  if (!decision.allow) {
    return {
      decision,
      recipientProfile,
      recipientRiskPolicy,
      onboardingHint: onboardingHintFor(decision),
      haltedAt: "gate-deny",
    };
  }

  if (!recipientProfile.address || !isAddress(recipientProfile.address)) {
    return {
      decision,
      recipientProfile,
      recipientRiskPolicy,
      haltedAt: "recipient-unresolved",
      onboardingHint: `${opts.recipientEns} has no resolvable address record`,
    };
  }

  // 4. Apply local clamps. The router enforces tier-bucket caps on-chain;
  //    RiskPolicy.maxAcceptedSize is enforced by the oracle. We pre-clamp
  //    here so the diagnostic + the actual quote are consistent.
  let amount = opts.amount;
  let clampApplied: ClampApplied | undefined;
  if (
    recipientRiskPolicy &&
    opts.amount > recipientRiskPolicy.maxAcceptedSize
  ) {
    clampApplied = {
      reason: `recipient RiskPolicy.maxAcceptedSize=${recipientRiskPolicy.maxAcceptedSize}`,
      original: opts.amount,
      clamped: recipientRiskPolicy.maxAcceptedSize,
    };
    amount = recipientRiskPolicy.maxAcceptedSize;
  }

  // 5. Request attestation from the oracle. Tier=none on either side or a
  //    RiskPolicy mismatch turns into `OracleRefusalError`. The HTTP oracle
  //    (Phase 2+) requires `swapperEns` + `recipientEns` so it can re-resolve
  //    both sides via TRL; mock client ignores them.
  let attestation: Attestation;
  let attestationSignature: Hex;
  try {
    const result = await opts.oracleClient.attest({
      swapperEns: opts.callerEns,
      recipientEns: opts.recipientEns,
      swapper: opts.signer.address,
      recipient: recipientProfile.address as Address,
      tokenIn: opts.tokenIn,
      tokenOut: opts.tokenOut,
      amountIn: amount.toString(),
    });
    attestation = result.attestation;
    attestationSignature = result.signature;
  } catch (err) {
    if (err instanceof OracleRefusalError) {
      return {
        decision,
        recipientProfile,
        recipientRiskPolicy,
        clampApplied,
        haltedAt: "oracle-refusal",
        onboardingHint: err.hint ?? err.message,
      };
    }
    throw err;
  }

  // 6. Apply the swapper-side tier-bucket cap derived from the attestation.
  //    The router will revert if violated; pre-clamping keeps the local
  //    diagnostic honest.
  const swapperBucket = tierBucket[attestation.swapperTier];
  if (amount > swapperBucket.maxTradeSize) {
    const original = clampApplied?.original ?? opts.amount;
    clampApplied = {
      reason: `swapper tier=${attestation.swapperTier} maxTradeSize=${swapperBucket.maxTradeSize}`,
      original,
      clamped: swapperBucket.maxTradeSize,
    };
    amount = swapperBucket.maxTradeSize;
  }

  // 7. Fetch the quote + swap calldata from Trading API.
  let quote: QuoteResponse;
  let swapTransaction: SwapTransaction;
  try {
    quote = await opts.tradingClient.quote({
      swapper: opts.signer.address,
      tokenIn: opts.tokenIn,
      tokenOut: opts.tokenOut,
      tokenInChainId: chainId,
      tokenOutChainId: chainId,
      amount,
    });
    const swapResponse = await opts.tradingClient.swap({ quote });
    swapTransaction = swapResponse.swap;
  } catch (err) {
    return {
      decision,
      recipientProfile,
      recipientRiskPolicy,
      attestation,
      attestationSignature,
      clampApplied,
      haltedAt: "quote-failed",
      onboardingHint:
        err instanceof Error ? err.message : "trading API call failed",
    };
  }

  // 8. Encode the gatedSwap calldata. This wraps the Universal Router
  //    calldata, the oracle attestation, and the oracle signature into
  //    one call against the future TrustSwapRouter.
  const routerCalldata = buildGatedSwapCalldata({
    universalRouterCalldata: swapTransaction.data,
    attestation,
    oracleSig: attestationSignature,
  });

  // 9. Sign + broadcast — unless dry-run.
  if (dryRun) {
    return {
      decision,
      recipientProfile,
      recipientRiskPolicy,
      attestation,
      attestationSignature,
      quote,
      swapTransaction,
      routerCalldata,
      clampApplied,
      txHash: SYNTHETIC_TXHASH,
    };
  }

  let txHash: Hex;
  try {
    txHash = await opts.signer.execute([
      {
        chainId,
        atomic: true,
        calls: [
          {
            to: routerAddress,
            data: routerCalldata,
            value: BigInt(swapTransaction.value),
          },
        ],
      },
    ]);
  } catch (err) {
    return {
      decision,
      recipientProfile,
      recipientRiskPolicy,
      attestation,
      attestationSignature,
      quote,
      swapTransaction,
      routerCalldata,
      clampApplied,
      haltedAt: "swap-failed",
      onboardingHint:
        err instanceof Error ? err.message : "signer.execute failed",
    };
  }

  return {
    decision,
    recipientProfile,
    recipientRiskPolicy,
    attestation,
    attestationSignature,
    quote,
    swapTransaction,
    routerCalldata,
    txHash,
    clampApplied,
  };
}

// ---------------------------------------------------------------------------
// Onboarding hint generator
//
// Maps `gate()` deny reasons to actionable suggestions. Phase 3 (`tru policy
// publish`) extends this with RiskPolicy-driven hints; this is the floor.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Subname tier inheritance
//
// Mirrors the oracle's `inheritTierFromParent` (packages/oracle/src/index.ts).
// Replaces the ENS-name + address fields with the subname's, but inherits
// every TRL-layer field from the parent — so `gate()` checks like
// `requireLineage` and `requireSig` use the parent's verified manifest data
// when they exist on the parent ENS.
// ---------------------------------------------------------------------------

async function resolveWithSubnameInheritance(
  ensName: string,
  resolveOptions: ResolveOptions | undefined,
  resolveTP: (
    ensName: string,
    options?: ResolveOptions,
  ) => Promise<TrustProfile>,
): Promise<TrustProfile> {
  const profile = await resolveTP(ensName, resolveOptions);
  if (profile.trustScore !== "none") return profile;
  const labels = ensName.split(".");
  if (labels.length < 3) return profile;
  const parent = ensName.slice(ensName.indexOf(".") + 1);
  try {
    const parentProfile = await resolveTP(parent, resolveOptions);
    if (parentProfile.trustScore === "none") return profile;
    // Synthesis's `resolve()` occasionally returns `address: null` for
    // subnames even when the address record is set (intermittent ENS RPC
    // flakiness across the parallel layer queries). Fall back to a
    // single-purpose live ENS lookup — same data source, fewer parallel
    // calls = fewer races. No hardcode; the address comes from whatever
    // the ENS contract returns for `ensName` at request time.
    let address = profile.address;
    if (!address) {
      try {
        const client = createEnsClient(resolveOptions?.ensRpcUrl);
        address = await resolveAddress(client, ensName);
      } catch {
        // swallow — keep original null
      }
    }
    return {
      ...parentProfile,
      ensName,
      address,
    };
  } catch {
    return profile;
  }
}

function onboardingHintFor(decision: GateDecision): string {
  const reason = decision.reason;
  const tier = decision.profile.trustScore;

  if (/self-resolution/.test(reason)) {
    return "the swap target resolves to the caller's own ENS — pass --allow-self to permit, or check the recipient input.";
  }
  if (/^tier none below/.test(reason)) {
    return "recipient has no TRL layers — ask them to register on AgentBook (tier none → registered).";
  }
  if (/^tier registered below/.test(reason)) {
    return "recipient is registered but lacks ENSIP-25 identity. Ask them to publish an identity record.";
  }
  if (/^tier discoverable below/.test(reason)) {
    return "recipient is discoverable but lacks an AIP manifest. Ask them to ship one (tier discoverable → verified).";
  }
  if (/^tier verified below/.test(reason)) {
    return "recipient is verified but lacks a domain-served SKILL.md. Ask them to publish one (tier verified → full).";
  }
  if (/manifest signature/.test(reason)) {
    return `recipient's manifest signature does not match the current ENS owner — they may have transferred the name. Ask them to re-sign.`;
  }
  if (/lineage broken/.test(reason)) {
    return "recipient's manifest lineage chain has a broken signature — an earlier version was signed by a different key.";
  }
  return `gate denied at tier ${tier}: ${reason}`;
}
