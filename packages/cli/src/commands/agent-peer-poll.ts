import { z } from "zod";
import { resolveAgentEndpoint } from "@trust-swap/core";
import type { OperatingPolicy, OperatingPolicyIntent } from "@trust-swap/core";
import type { PublicClient } from "viem";

// ---------------------------------------------------------------------------
// A2A peer poll (Phase 6c, TRU-43)
//
// Read side of the A2A handshake. For each peer in `policy.listen.peers`,
// resolve their `agent-endpoint` text record, GET the JSON, and evaluate
// each advertised intent against this daemon's local policy.
//
// This module is the discovery + gating step. Actual settlement via
// gatedSwap is a separate follow-up (TRU-43 part 2): once the gate
// returns "match", the daemon needs to pick a counterparty kernel as
// the recipient, attest, and run the swap. Both halves of that decision
// have policy implications worth landing in their own PR.
//
// The shape returned by `evaluatePeerIntent` is deliberately small:
// "match" or "decline" with a one-line reason. The audit log captures
// every evaluation as a JSONL event so the operator (and the demo) can
// see why each peer intent did or didn't fulfill, without the daemon
// having to reach for the oracle on declines.
// ---------------------------------------------------------------------------

const AdvertisedIntentSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("swap"),
  tokenIn: z.string().min(1),
  tokenOut: z.string().min(1),
  amount: z.string().min(1),
  recipient: z.string().min(1),
});

export const IntentsResponseSchema = z.object({
  ensName: z.string().min(1),
  kernelAddress: z.string().min(1),
  listedAt: z.string().min(1),
  intents: z.array(AdvertisedIntentSchema),
});

export type AdvertisedPeerIntent = z.infer<typeof AdvertisedIntentSchema>;
export type IntentsResponse = z.infer<typeof IntentsResponseSchema>;

// ---------------------------------------------------------------------------
// Pure evaluation
// ---------------------------------------------------------------------------

export type PeerIntentDecision = "match" | "decline";

export interface PeerIntentEvaluation {
  decision: PeerIntentDecision;
  reason: string;
  /** When `decision === "match"`, the local intent id whose pair matched. */
  matchedLocalIntentId?: string;
}

/**
 * Decide whether this daemon would, in principle, fulfill the peer's
 * advertised intent. The match is by token pair only:
 *
 *   - **match** when this daemon has at least one enabled local intent
 *     with the same `(tokenIn, tokenOut)` pair (case-insensitive).
 *   - **decline** otherwise.
 *
 * Amount, recipient, and per-side RiskPolicy gating are intentionally
 * deferred. The pair-match is the cheapest safe filter — it tells the
 * operator "there's a peer asking for a swap I'd consider doing" without
 * pretending the daemon has solved the harder economic question of
 * whose funds settle the trade. That decision lands with the gatedSwap
 * settlement work in the follow-up PR.
 */
export function evaluatePeerIntent(
  localIntents: ReadonlyArray<OperatingPolicyIntent>,
  peerIntent: AdvertisedPeerIntent,
): PeerIntentEvaluation {
  const tokenIn = peerIntent.tokenIn.toLowerCase();
  const tokenOut = peerIntent.tokenOut.toLowerCase();
  const local = localIntents.find(
    (i) =>
      i.enabled &&
      i.kind === peerIntent.kind &&
      i.tokenIn.toLowerCase() === tokenIn &&
      i.tokenOut.toLowerCase() === tokenOut,
  );
  if (!local) {
    return {
      decision: "decline",
      reason: `no enabled local intent for ${peerIntent.tokenIn}→${peerIntent.tokenOut}`,
    };
  }
  return {
    decision: "match",
    reason: `matches local intent "${local.id}"`,
    matchedLocalIntentId: local.id,
  };
}

// ---------------------------------------------------------------------------
// Network fetch
// ---------------------------------------------------------------------------

export interface FetchPeerIntentsOptions {
  fetchImpl?: typeof fetch;
  ensClient?: PublicClient;
  ensRpcUrl?: string;
  /** Hard ceiling on the GET. Default 5s — peers on Tailscale should be ~ms. */
  timeoutMs?: number;
}

export type PeerFetchOutcome =
  | { kind: "ok"; body: IntentsResponse }
  | { kind: "no-endpoint" }
  | { kind: "fetch-failed"; message: string }
  | { kind: "parse-failed"; message: string };

export async function fetchPeerIntents(
  peerEnsName: string,
  options: FetchPeerIntentsOptions = {},
): Promise<PeerFetchOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;

  const endpoint = await resolveAgentEndpoint(peerEnsName, {
    client: options.ensClient,
    ensRpcUrl: options.ensRpcUrl,
  });
  if (!endpoint) {
    return { kind: "no-endpoint" };
  }

  // `agent-endpoint` is a **base URL** by ENSIP-26 convention — the same
  // record is used by `resolveRiskPolicy` to reach `<endpoint>/policy`
  // (see risk-policy.ts:fetchPolicyFromEndpoint). Mirror that shape here
  // so a single ENS write can feed both the discovery and the
  // policy-override paths. Strip trailing slashes to match exactly what
  // /policy does.
  const url = `${endpoint.replace(/\/+$/, "")}/intents`;

  // AbortController on the fetch so a stalled peer can't wedge a tick.
  // Tailscale RTT is sub-ms; anything above timeoutMs is a real outage,
  // not slow-network noise.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let body: unknown;
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        kind: "fetch-failed",
        message: `HTTP ${res.status} from ${url}`,
      };
    }
    body = await res.json();
  } catch (err) {
    return {
      kind: "fetch-failed",
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }

  const parsed = IntentsResponseSchema.safeParse(body);
  if (!parsed.success) {
    return {
      kind: "parse-failed",
      message: parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; "),
    };
  }
  return { kind: "ok", body: parsed.data };
}

// ---------------------------------------------------------------------------
// Orchestration — one full pass over the configured peers
// ---------------------------------------------------------------------------

export interface PeerPollResult {
  peerEnsName: string;
  outcome: PeerFetchOutcome;
  /** Per-intent evaluations (empty when outcome.kind !== "ok"). */
  evaluations: ReadonlyArray<{
    peerIntent: AdvertisedPeerIntent;
    evaluation: PeerIntentEvaluation;
  }>;
}

/**
 * Poll each peer in `policy.listen.peers` once and return the gathered
 * evaluations. Caller is responsible for emitting JSONL events / scheduling
 * — this function is pure-ish (it does I/O but no side effects on local
 * state), making it straightforward to test against a fetch stub.
 */
export async function pollPeers(
  policy: OperatingPolicy,
  options: FetchPeerIntentsOptions = {},
): Promise<ReadonlyArray<PeerPollResult>> {
  const listen = policy.listen;
  if (!listen) return [];
  const localIntents = policy.intents;
  const maxConcurrent = listen.maxConcurrentIntents;

  const results: PeerPollResult[] = [];
  for (const peer of listen.peers) {
    const outcome = await fetchPeerIntents(peer, options);
    if (outcome.kind !== "ok") {
      results.push({ peerEnsName: peer, outcome, evaluations: [] });
      continue;
    }
    const evaluations: PeerPollResult["evaluations"] = outcome.body.intents
      // `maxConcurrentIntents` bounds how many advertised intents from
      // a single peer we'll evaluate per tick. Demo guard against a
      // misbehaving peer broadcasting hundreds of dust intents.
      .slice(0, maxConcurrent)
      .map((peerIntent) => ({
        peerIntent,
        evaluation: evaluatePeerIntent(localIntents, peerIntent),
      }));
    results.push({ peerEnsName: peer, outcome, evaluations });
  }
  return results;
}
