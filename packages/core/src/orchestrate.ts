import {
  encodeFunctionData,
  isAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";
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
import { defaultSwapPolicy } from "./policy.js";
import { resolveRiskPolicy, type RiskPolicy } from "./risk-policy.js";
import {
  isUniswapXQuote,
  type QuoteResponse,
  type SwapTransaction,
  type TradingClient,
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
          // Echo whatever calldataHash the caller sent so the mock-driven
          // contract path still passes the on-chain hash check. If the
          // caller didn't supply one (e.g. unit tests that don't broadcast),
          // fall back to a zero hash.
          calldataHash:
            req.calldataHash ?? (`0x${"00".repeat(32)}` as Hex),
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
          { name: "calldataHash", type: "bytes32" },
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
        calldataHash: args.attestation.calldataHash,
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
  | "risk-policy-deny"
  | "recipient-unresolved"
  | "oracle-refusal"
  | "quote-failed"
  | "swap-failed";

/**
 * @deprecated Phase 3 (TRU-65) replaced silent amount-clamping with an explicit
 * `risk-policy-deny` halt. This type is retained only for backwards-compatible
 * imports during the migration; orchestrate no longer populates it.
 */
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
  /** Resolved when `callerEns` is set; null otherwise (oracle still re-resolves). */
  swapperProfile?: TrustProfile | null;
  attestation?: Attestation;
  attestationSignature?: Hex;
  quote?: QuoteResponse;
  swapTransaction?: SwapTransaction;
  routerCalldata?: Hex;
  txHash?: Hex;
  /** @deprecated TRU-65 replaced clamp with halt; never populated. */
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

  // 2. Fetch the recipient's RiskPolicy unconditionally. Always surfaced in
  //    `OrchestrateResult.recipientRiskPolicy` so callers can show a
  //    diagnostic regardless of whether the gate or the pre-flight fires.
  const recipientRiskPolicy = await resolveRP(opts.recipientEns);

  // 2b. If a callerEns is provided, resolve the swapper through TRL too. Used
  //     by the RiskPolicy pre-flight to detect a tier mismatch locally before
  //     spending an oracle round-trip. Failure is non-fatal — the oracle
  //     re-resolves both sides and remains authoritative.
  let swapperProfile: TrustProfile | null = null;
  if (opts.callerEns) {
    try {
      swapperProfile = await resolveWithSubnameInheritance(
        opts.callerEns,
        opts.resolveOptions,
        resolveTP,
      );
    } catch {
      // swallow — pre-flight will skip the tier check; oracle still binding.
    }
  }

  // 3. Local pre-flight `gate()` — produces an early diagnostic. The oracle
  //    is the on-chain authority, but stopping here saves a Trading API
  //    round trip when the gate would deny anyway.
  const decision = gate(recipientProfile, policy, opts.callerEns);
  if (!decision.allow) {
    return {
      decision,
      recipientProfile,
      recipientRiskPolicy,
      swapperProfile,
      onboardingHint: onboardingHintFor(decision),
      haltedAt: "gate-deny",
    };
  }

  if (!recipientProfile.address || !isAddress(recipientProfile.address)) {
    return {
      decision,
      recipientProfile,
      recipientRiskPolicy,
      swapperProfile,
      haltedAt: "recipient-unresolved",
      onboardingHint: `${opts.recipientEns} has no resolvable address record`,
    };
  }

  // 4. RiskPolicy pre-flight (TRU-65). Diagnostic only — the oracle re-runs
  //    these checks against fresh resolutions and is the binding signal.
  //    Short-circuiting here avoids a Trading API call + oracle round-trip
  //    when we can already tell the swap won't satisfy the recipient.
  if (recipientRiskPolicy) {
    const hint = riskPolicyPreflight({
      recipientEns: opts.recipientEns,
      tokenIn: opts.tokenIn,
      amount: opts.amount,
      swapperProfile,
      recipientRiskPolicy,
    });
    if (hint) {
      return {
        decision,
        recipientProfile,
        recipientRiskPolicy,
        swapperProfile,
        haltedAt: "risk-policy-deny",
        onboardingHint: hint,
      };
    }
  }

  const amount = opts.amount;

  // 5. Fetch the quote + swap calldata from Trading API FIRST. The
  //    attestation now binds to a `calldataHash` (= keccak256 of the UR
  //    calldata), so the calldata must exist before the oracle signs.
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
      swapperProfile,
      haltedAt: "quote-failed",
      onboardingHint:
        err instanceof Error ? err.message : "trading API call failed",
    };
  }

  // 6. Encode the would-be gatedSwap calldata against a SENTINEL
  //    attestation, then extract the UR calldata to hash. We need the
  //    hash before we can ask the oracle to sign — so we don't yet have a
  //    real attestation; the contract's `keccak256(universalRouterCalldata)
  //    == att.calldataHash` check uses ONLY the bytes of `swapTransaction.data`,
  //    which is what the oracle will be asked to attest.
  const calldataHash = keccak256(swapTransaction.data);
  const expectedOutAmount = isUniswapXQuote(quote)
    ? quote.quote.orderInfo.outputs[0]?.endAmount ??
      quote.quote.orderInfo.outputs[0]?.startAmount
    : quote.quote.output.amount;

  // 7. Request attestation from the oracle. The HTTP oracle re-resolves
  //    both sides via TRL, runs bidirectional RiskPolicy with the real
  //    `amountInbound` for the swapper-side check (closes Codex P2 #3),
  //    and signs over a tuple that includes `calldataHash` (closes Codex
  //    P1 #2 — attestations bind to the exact swap shape).
  //
  //    Codex P1 #1 — fail-fast when callerEns is missing on the HTTP path
  //    instead of letting the oracle's 400 bubble as an unhandled error.
  if (!opts.callerEns) {
    return {
      decision,
      recipientProfile,
      recipientRiskPolicy,
      swapperProfile,
      quote,
      swapTransaction,
      haltedAt: "oracle-refusal",
      onboardingHint:
        "callerEns (--caller-ens) is required when using a real oracle. Pass your identity ENS so the oracle can re-resolve your TrustProfile.",
    };
  }
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
      amountOut: expectedOutAmount,
      calldataHash,
    });
    attestation = result.attestation;
    attestationSignature = result.signature;
  } catch (err) {
    if (err instanceof OracleRefusalError) {
      return {
        decision,
        recipientProfile,
        recipientRiskPolicy,
        swapperProfile,
        quote,
        swapTransaction,
        haltedAt: "oracle-refusal",
        onboardingHint: err.hint ?? err.message,
      };
    }
    throw err;
  }

  // 8. Encode the gatedSwap calldata. The contract verifies
  //    `keccak256(universalRouterCalldata) == att.calldataHash` before
  //    forwarding — replays against a different swap shape revert.
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
      swapperProfile,
      attestation,
      attestationSignature,
      quote,
      swapTransaction,
      routerCalldata,
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
      swapperProfile,
      attestation,
      attestationSignature,
      quote,
      swapTransaction,
      routerCalldata,
      haltedAt: "swap-failed",
      onboardingHint:
        err instanceof Error ? err.message : "signer.execute failed",
    };
  }

  return {
    decision,
    recipientProfile,
    recipientRiskPolicy,
    swapperProfile,
    attestation,
    attestationSignature,
    quote,
    swapTransaction,
    routerCalldata,
    txHash,
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

// ---------------------------------------------------------------------------
// RiskPolicy pre-flight (TRU-65)
//
// Returns a hint string when the swap will *clearly* fail the recipient's
// RiskPolicy. Returns null when nothing trips — the oracle still re-validates
// against fresh resolutions and is the binding signal.
//
// Order of checks: token → tier → size. Each is independently sufficient to
// halt; we report the first that fires so the user sees the most actionable
// fix. (Tokens first because it's the most common misconfiguration; tier
// next because resolving an identity layer takes the longest; size last
// because it's a one-flag fix.)
// ---------------------------------------------------------------------------

function riskPolicyPreflight(args: {
  recipientEns: string;
  tokenIn: Address;
  amount: bigint;
  swapperProfile: TrustProfile | null;
  recipientRiskPolicy: RiskPolicy;
}): string | null {
  const { recipientEns, tokenIn, amount, swapperProfile, recipientRiskPolicy } =
    args;

  // 1. Token check — only meaningful when the recipient declared a non-empty
  //    accept-list. An empty list means "any token".
  if (recipientRiskPolicy.acceptedTokens.length > 0) {
    const offered = tokenIn.toLowerCase();
    const accepted = recipientRiskPolicy.acceptedTokens.map((t) =>
      t.toLowerCase(),
    );
    if (!accepted.includes(offered)) {
      const list = recipientRiskPolicy.acceptedTokens
        .map(shortAddr)
        .join(", ");
      return `${recipientEns} accepts only ${list}; you offered ${shortAddr(tokenIn)}.`;
    }
  }

  // 2. Tier check — requires a resolved swapper profile, which only exists
  //    when callerEns was passed. Skip silently when absent (oracle covers).
  if (swapperProfile) {
    const swapperIdx = TIER_INDEX[swapperProfile.trustScore];
    const minIdx = TIER_INDEX[recipientRiskPolicy.minCounterpartyTier];
    if (swapperIdx < minIdx) {
      return `${recipientEns} requires tier \`${recipientRiskPolicy.minCounterpartyTier}\`+; you're at \`${swapperProfile.trustScore}\`. Resolve via AgentBook → AIP manifest.`;
    }
  }

  // 3. Size check — denominated in the recipient's RiskPolicy units (which
  //    `tu policy publish` records as 6-decimal USDC base units). The CLI
  //    must pass `amount` in matching units; we compare bigint-against-bigint
  //    rather than trying to renormalize here.
  if (amount > recipientRiskPolicy.maxAcceptedSize) {
    return `${recipientEns} caps inbound at ${recipientRiskPolicy.maxAcceptedSize} base units; you requested ${amount}. Resubmit with a smaller --amount or split.`;
  }

  return null;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
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
