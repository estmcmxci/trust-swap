import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import {
  scrypt,
  createDecipheriv,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { parseUnits, createPublicClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { createKernelAccount, createKernelAccountClient } from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_3 } from "@zerodev/sdk/constants";
import { toMultiChainECDSAValidator } from "@zerodev/multi-chain-ecdsa-validator";
import { deserializePermissionAccount } from "@zerodev/permissions";
import { toECDSASigner } from "@zerodev/permissions/signers";
import type { Batch, Signer } from "@synthesis/resolver";
import {
  createMockOracleClient,
  createHttpOracleClient,
  createTradingClient,
  getOutputAmount,
  loadOperatingPolicyFromDisk,
  orchestrate,
  type OperatingPolicy,
  type OperatingPolicyIntent,
  type OracleClient,
  type OrchestrateResult,
  type TradingClient,
} from "@trust-swap/core";
import { resolveToken } from "../utils/tokens.js";

// ---------------------------------------------------------------------------
// `tru agent run` — operating-policy-driven autonomous loop.
//
// One tick per `schedule.intervalSec`:
//   1. Re-read policy from disk (atomic-write detection — OpenClaw edits)
//   2. Pick the next due intent (round-robin over enabled intents)
//   3. Apply constraints (time-since-last, daily-spend, halt counter)
//   4. Run `orchestrate(...)` against the deployed router via the daemon's
//      session key
//   5. Emit a JSONL event to stdout + push to status ring buffer
//
// Constraints, intent selection, and JSONL shape are all extracted into
// pure helpers below so they unit-test cleanly. The runtime glue (signer
// build, HTTP server, signal handlers) lives in `runAgentRun`.
// ---------------------------------------------------------------------------

export interface AgentRunOptions {
  policy: string;
  signer?: "namera";
  maxIterations?: number;
  /** Default 127.0.0.1:18790 locally; deployment overrides via TRU_AGENT_STATUS_BIND. */
  statusBind?: string;
}

// ---------------------------------------------------------------------------
// Pure constraint logic (unit-tested)
// ---------------------------------------------------------------------------

export interface AgentState {
  /** UTC-midnight epoch (sec) of the day we're tracking spend for. */
  dayStart: number;
  /** USD spent so far today (post-trade, summed from orchestrate results). */
  spentUsdToday: number;
  /** Epoch (sec) of the last successful or attempted swap, whichever is later. */
  lastSwapAt: number | null;
  /** Consecutive orchestrate failures since the last success. */
  consecutiveFailures: number;
  /** Halted state — set true once `haltOnConsecutiveFailures` trips. */
  halted: boolean;
  /** Round-robin cursor over the policy's intents. */
  intentCursor: number;
}

export function initialAgentState(now: number): AgentState {
  return {
    dayStart: utcDayStart(now),
    spentUsdToday: 0,
    lastSwapAt: null,
    consecutiveFailures: 0,
    halted: false,
    intentCursor: 0,
  };
}

/**
 * Unix-epoch seconds → UTC-midnight epoch seconds for that day. Used to
 * roll the spent-today counter at midnight UTC consistently across hosts.
 */
export function utcDayStart(epochSec: number): number {
  return Math.floor(epochSec / 86400) * 86400;
}

/**
 * Pure intent picker. Round-robins over `enabled` intents starting at
 * `state.intentCursor`. Returns `null` if no intent is enabled.
 *
 * The returned `nextCursor` is the index *after* the picked intent so the
 * caller can update `state` for the next tick.
 */
export function pickNextIntent(
  policy: OperatingPolicy,
  state: AgentState,
): { intent: OperatingPolicyIntent; nextCursor: number } | null {
  const intents = policy.intents;
  if (intents.length === 0) return null;
  for (let offset = 0; offset < intents.length; offset++) {
    const i = (state.intentCursor + offset) % intents.length;
    const intent = intents[i];
    if (!intent || !intent.enabled) continue;
    return { intent, nextCursor: (i + 1) % intents.length };
  }
  return null;
}

export type ConstraintCheck =
  | { ok: true; resetDailySpend: boolean }
  | { ok: false; reason: ConstraintBlockReason };

export type ConstraintBlockReason =
  | "halted-on-consecutive-failures"
  | "min-seconds-between-swaps"
  | "max-daily-spend"
  | "schedule-not-yet-started"
  | "schedule-already-ended";

/**
 * Pre-flight constraint check before running orchestrate. Returns ok with
 * `resetDailySpend: true` when the day rolled over (caller zeros the
 * counter in state). Constraint reasons are emitted as `tick.skipped`
 * JSONL events, not failures.
 */
export function applyConstraints(
  policy: OperatingPolicy,
  state: AgentState,
  now: number,
): ConstraintCheck {
  if (state.halted) {
    return { ok: false, reason: "halted-on-consecutive-failures" };
  }

  if (policy.schedule.startAt && now * 1000 < Date.parse(policy.schedule.startAt)) {
    return { ok: false, reason: "schedule-not-yet-started" };
  }
  if (policy.schedule.endAt && now * 1000 > Date.parse(policy.schedule.endAt)) {
    return { ok: false, reason: "schedule-already-ended" };
  }

  if (
    state.lastSwapAt !== null &&
    now - state.lastSwapAt < policy.constraints.minSecondsBetweenSwaps
  ) {
    return { ok: false, reason: "min-seconds-between-swaps" };
  }

  // Roll daily counter if we crossed UTC midnight
  const today = utcDayStart(now);
  const resetDailySpend = today !== state.dayStart;
  const spentForToday = resetDailySpend ? 0 : state.spentUsdToday;
  if (spentForToday >= policy.constraints.maxDailySpendUsd) {
    return { ok: false, reason: "max-daily-spend" };
  }

  return { ok: true, resetDailySpend };
}

// ---------------------------------------------------------------------------
// JSONL event shape — emitted to stdout + ring buffer
// ---------------------------------------------------------------------------

export type AgentEvent =
  | { type: "agent.start"; ts: string; ensName: string; kernelAddress: string; policy: string; iterations: number | "unbounded" }
  | { type: "tick.start"; ts: string; iter: number; policyHash: string }
  | {
      type: "tick.skipped";
      ts: string;
      iter: number;
      reason: ConstraintBlockReason | "no-enabled-intent";
    }
  | {
      type: "tick.swap";
      ts: string;
      iter: number;
      intentId: string;
      recipient: string;
      tokenIn: string;
      tokenOut: string;
      amount: string;
      txHash?: string;
      decision: string;
      haltedAt?: string;
      reason?: string;
      durationMs: number;
      success: boolean;
    }
  | {
      type: "tick.error";
      ts: string;
      iter: number;
      intentId: string;
      message: string;
    }
  | {
      type: "agent.halted";
      ts: string;
      iter: number;
      consecutiveFailures: number;
    }
  | {
      type: "agent.signer-rotated";
      ts: string;
      iter: number;
      sessionKeyPath: string;
      kernelAddress: string;
    }
  | { type: "agent.shutdown"; ts: string; signal: string; iterations: number };

export function formatJsonl(event: AgentEvent): string {
  return JSON.stringify(event);
}

// ---------------------------------------------------------------------------
// Status endpoint — last N JSONL events as JSON array
// ---------------------------------------------------------------------------

class EventRing {
  private buffer: AgentEvent[] = [];
  constructor(private readonly capacity: number = 100) {}
  push(e: AgentEvent): void {
    this.buffer.push(e);
    if (this.buffer.length > this.capacity) this.buffer.shift();
  }
  snapshot(): AgentEvent[] {
    return this.buffer.slice();
  }
}

/**
 * Parse a `host:port` bind string. Accepts:
 *   - IPv4 / hostname:  `127.0.0.1:18790`, `localhost:18790`
 *   - Bracketed IPv6:   `[fd7a:115c:a1e0::1]:18790`, `[::1]:18790`
 *
 * Bare IPv6 (without brackets) is ambiguous because the address itself
 * contains colons, so we require the bracket form — same convention Node's
 * URL parser and most networking tools use.
 */
export function parseStatusBind(bind: string): { host: string; port: number } {
  const trimmed = bind.trim();
  let host: string;
  let portStr: string;
  if (trimmed.startsWith("[")) {
    const close = trimmed.indexOf("]");
    if (close === -1) {
      throw new Error(`invalid status bind "${bind}" — unterminated IPv6 bracket`);
    }
    host = trimmed.slice(1, close);
    if (trimmed[close + 1] !== ":") {
      throw new Error(`invalid status bind "${bind}" — expected ":port" after "]"`);
    }
    portStr = trimmed.slice(close + 2);
  } else {
    const sep = trimmed.lastIndexOf(":");
    if (sep === -1) {
      throw new Error(`invalid status bind "${bind}" — expected "host:port"`);
    }
    host = trimmed.slice(0, sep);
    portStr = trimmed.slice(sep + 1);
  }
  if (host.length === 0) {
    throw new Error(`invalid status bind "${bind}" — empty host`);
  }
  if (portStr.length === 0) {
    throw new Error(`invalid status bind "${bind}" — empty port`);
  }
  if (!/^\d+$/.test(portStr)) {
    throw new Error(`invalid status bind "${bind}" — non-numeric port`);
  }
  const port = Number(portStr);
  if (port < 1 || port > 65535) {
    throw new Error(`invalid status bind "${bind}" — port ${port} out of range 1..65535`);
  }
  return { host, port };
}

function startStatusServer(bind: string, ring: EventRing): Server {
  const { host, port } = parseStatusBind(bind);
  const server = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    if (req.url === "/events") {
      const events = ring.snapshot();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ events }));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
  server.listen(port, host);
  return server;
}

// ---------------------------------------------------------------------------
// Daemon signer — reads serializedAccount + sessionPrivateKey from one file
// (the shape produced by scripts/provision-daemon.ts). Differs from the
// existing `buildNameraSigner` in `utils/signer.ts` because that one
// requires both halves to come from env; for the daemon we want a
// self-contained policy-driven setup.
// ---------------------------------------------------------------------------

async function buildDaemonSigner(
  sessionKeyPath: string,
  expectedKernel: Address,
  rpcUrl: string,
  bundlerUrl: string,
): Promise<Signer> {
  const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
  const entryPoint = getEntryPoint("0.7");

  // Owner-key fast path. When DAEMON_OWNER_KEYSTORE_PATH is in env, we
  // decrypt the daemon's encrypted owner keystore (mode 0600 on disk)
  // and sign userOps directly with the kernel's owner ECDSA validator
  // — full sudo, no permission-validator install dance, no session-key
  // serialization assumptions. Lower-trust than the session-key path
  // (the daemon owns its kernel outright at this point), but the
  // on-chain RiskPolicy + router gate are still enforced; the daemon
  // just doesn't have an additional toCallPolicy ceiling on top.
  //
  // TODO(TRU-86): switch back to session-key signing once we figure
  // out why deserializePermissionAccount's first userOp reverts in
  // EntryPoint simulation against a freshly-deployed kernel.
  const ownerKey = await maybeLoadOwnerKey();
  if (ownerKey) {
    const ownerAccount = privateKeyToAccount(ownerKey);
    const sudoValidator = await toMultiChainECDSAValidator(publicClient, {
      entryPoint,
      kernelVersion: KERNEL_V3_3,
      signer: ownerAccount,
    });
    const account = await createKernelAccount(publicClient, {
      entryPoint,
      index: 0n,
      kernelVersion: KERNEL_V3_3,
      plugins: { sudo: sudoValidator },
    });
    if (account.address.toLowerCase() !== expectedKernel.toLowerCase()) {
      throw new Error(
        `owner-key kernel ${account.address} ≠ policy.agent.kernelAddress ${expectedKernel}`,
      );
    }
    return makeKernelSigner(account, publicClient, bundlerUrl);
  }

  const expanded = sessionKeyPath.startsWith("~/")
    ? `${process.env.HOME ?? ""}${sessionKeyPath.slice(1)}`
    : sessionKeyPath;
  if (!existsSync(expanded)) {
    throw new Error(`session key file not found: ${expanded}`);
  }
  const json = JSON.parse(readFileSync(expanded, "utf-8"));
  const serialized = json.serializedAccount;
  const privateKey = json.sessionPrivateKey as Hex | undefined;
  if (typeof serialized !== "string" || serialized.length === 0) {
    throw new Error(`session key file ${expanded} missing serializedAccount`);
  }
  if (!privateKey || !privateKey.startsWith("0x")) {
    throw new Error(
      `session key file ${expanded} missing sessionPrivateKey — re-run pnpm provision:daemon`,
    );
  }

  const sessionAccount = privateKeyToAccount(privateKey);
  const ecdsa = await toECDSASigner({ signer: sessionAccount });
  const account = await deserializePermissionAccount(
    publicClient,
    entryPoint,
    KERNEL_V3_3,
    serialized,
    ecdsa,
  );

  if (account.address.toLowerCase() !== expectedKernel.toLowerCase()) {
    throw new Error(
      `session key kernel ${account.address} ≠ policy.agent.kernelAddress ${expectedKernel}`,
    );
  }
  return makeKernelSigner(account, publicClient, bundlerUrl);
}

// Decrypt the daemon's owner keystore in memory and return the private
// key. Returns null when DAEMON_OWNER_KEYSTORE_PATH isn't set (caller
// falls through to the session-key path).
async function maybeLoadOwnerKey(): Promise<Hex | null> {
  const path = process.env.DAEMON_OWNER_KEYSTORE_PATH;
  if (!path) return null;
  const password = process.env.DAEMON_OWNER_KEYSTORE_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error(
      "DAEMON_OWNER_KEYSTORE_PASSWORD missing or too short — owner-key path requires the keystore password in env",
    );
  }
  const expanded = path.startsWith("~/")
    ? `${process.env.HOME ?? ""}${path.slice(1)}`
    : path;
  if (!existsSync(expanded)) {
    throw new Error(`daemon owner keystore not found: ${expanded}`);
  }
  const keystore = JSON.parse(readFileSync(expanded, "utf-8"));
  const { kdfparams, ciphertext, cipherparams, mac, cipher, kdf } = keystore.crypto;
  if (cipher !== "aes-256-ctr" || kdf !== "scrypt") {
    throw new Error("unsupported keystore format");
  }
  const scryptAsync = promisify<Buffer | string, Buffer | string, number, Buffer>(scrypt);
  const dk = await scryptAsync(
    password,
    Buffer.from(kdfparams.salt, "hex"),
    kdfparams.dklen ?? 32,
  );
  const ct = Buffer.from(ciphertext, "hex");
  const expectedMac = createHash("sha256")
    .update(Buffer.concat([dk.subarray(16, 32), ct]))
    .digest();
  if (!timingSafeEqual(expectedMac, Buffer.from(mac, "hex"))) {
    throw new Error("daemon owner keystore MAC mismatch — wrong password");
  }
  const decipher = createDecipheriv(
    "aes-256-ctr",
    dk,
    Buffer.from(cipherparams.iv, "hex"),
  );
  return `0x${Buffer.concat([decipher.update(ct), decipher.final()]).toString("hex")}` as Hex;
}

// Common bundler-fee + execute wrapper used by both signing paths.
function makeKernelSigner(
  account: Awaited<ReturnType<typeof createKernelAccount>>,
  publicClient: ReturnType<typeof createPublicClient>,
  bundlerUrl: string,
): Signer {

  const kernelClient = createKernelAccountClient({
    account,
    bundlerTransport: http(bundlerUrl),
    chain: base,
    client: publicClient,
    userOperation: {
      // Same Pimlico-fees override as utils/signer.ts — see the comment
      // there for why this is necessary.
      estimateFeesPerGas: async ({ bundlerClient }) => {
        const gp = (await bundlerClient.request({
          method: "pimlico_getUserOperationGasPrice" as never,
          params: [],
        })) as { standard: { maxFeePerGas: Hex; maxPriorityFeePerGas: Hex } };
        return {
          maxFeePerGas: BigInt(gp.standard.maxFeePerGas),
          maxPriorityFeePerGas: BigInt(gp.standard.maxPriorityFeePerGas),
        };
      },
    },
  });

  return {
    address: account.address as Address,
    async execute(batches: Batch[]): Promise<`0x${string}`> {
      let lastTxHash: `0x${string}` | undefined;
      for (const batch of batches) {
        if (batch.chainId !== base.id) {
          throw new Error(
            `daemon signer pinned to Base (${base.id}); refusing batch on chainId ${batch.chainId}`,
          );
        }
        const userOpHash = await kernelClient.sendUserOperation({
          calls: batch.calls.map((c) => ({ to: c.to, data: c.data, value: c.value })),
        });
        const receipt = await kernelClient.waitForUserOperationReceipt({
          hash: userOpHash,
        });
        if (!receipt.success) {
          throw new Error(
            `daemon signer: user-op ${userOpHash} reverted on-chain (txHash ${receipt.receipt.transactionHash})`,
          );
        }
        lastTxHash = receipt.receipt.transactionHash;
      }
      if (!lastTxHash) throw new Error("daemon signer: no batches executed");
      return lastTxHash;
    },
  };
}

// ---------------------------------------------------------------------------
// Runtime loop
// ---------------------------------------------------------------------------

export async function runAgentRun(options: AgentRunOptions): Promise<void> {
  if (options.signer && options.signer !== "namera") {
    throw new Error(`--signer must be "namera" (got "${options.signer}")`);
  }
  const policyPath = options.policy;
  const maxIterations = options.maxIterations ?? Number.POSITIVE_INFINITY;
  const statusBind =
    options.statusBind ?? process.env.TRU_AGENT_STATUS_BIND ?? "127.0.0.1:18790";

  // First load — fail loud if the policy is malformed
  let policy = await loadOperatingPolicyFromDisk(policyPath);

  const apiKey = process.env.UNISWAP_API_KEY;
  if (!apiKey) throw new Error("UNISWAP_API_KEY not set");
  const tradingClient: TradingClient = createTradingClient({ apiKey });

  const oracleUrl = process.env.ORACLE_URL;
  const oracleClient: OracleClient = oracleUrl
    ? createHttpOracleClient({ url: oracleUrl })
    : createMockOracleClient();

  const rpcUrl = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
  const bundlerUrl = process.env.BUNDLER_URL_BASE;
  if (!bundlerUrl) throw new Error("BUNDLER_URL_BASE not set");

  let signer = await buildDaemonSigner(
    policy.agent.sessionKeyPath,
    policy.agent.kernelAddress,
    rpcUrl,
    bundlerUrl,
  );
  let signerSessionKeyPath = policy.agent.sessionKeyPath;
  let signerKernelAddress = policy.agent.kernelAddress;

  const ring = new EventRing(100);
  const emit = (e: AgentEvent) => {
    ring.push(e);
    process.stdout.write(`${formatJsonl(e)}\n`);
  };

  const statusServer = startStatusServer(statusBind, ring);

  emit({
    type: "agent.start",
    ts: new Date().toISOString(),
    ensName: policy.agent.ensName,
    kernelAddress: policy.agent.kernelAddress,
    policy: policyPath,
    iterations: Number.isFinite(maxIterations) ? maxIterations : "unbounded",
  });

  let state = initialAgentState(Math.floor(Date.now() / 1000));
  let tickCount = 0;
  let shuttingDown = false;
  // Aborts the in-flight inter-tick sleep so SIGTERM/SIGINT can return
  // within milliseconds rather than blocking up to one full intervalSec
  // (which routinely exceeds systemd's TimeoutStopSec and forces a kill).
  const shutdownAbort = new AbortController();
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    shutdownAbort.abort();
    emit({
      type: "agent.shutdown",
      ts: new Date().toISOString(),
      signal,
      iterations: tickCount,
    });
    statusServer.close();
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  // Gate the inter-tick sleep so bounded runs don't pay one extra
  // intervalSec after the final iteration (PR #10), and pass
  // shutdownAbort.signal so SIGTERM/SIGINT cuts the sleep short instead
  // of blocking systemctl stop for up to one full intervalSec (PR #11).
  const sleepUntilNext = async () => {
    if (shuttingDown || tickCount >= maxIterations) return;
    await sleep(policy.schedule.intervalSec * 1000, shutdownAbort.signal);
  };

  while (!shuttingDown && tickCount < maxIterations) {
    const tickStartedAt = Date.now();
    tickCount++;

    // Re-read policy on each tick so OpenClaw edits land within one cycle
    try {
      policy = await loadOperatingPolicyFromDisk(policyPath);
    } catch (err) {
      emit({
        type: "tick.error",
        ts: new Date().toISOString(),
        iter: tickCount,
        intentId: "(policy-reload)",
        message: err instanceof Error ? err.message : String(err),
      });
      await sleepUntilNext();
      continue;
    }

    // P1: if the operator rotated the daemon's session key or kernel address
    //     in the policy file, rebuild the signer before this tick runs so
    //     swaps don't keep executing under the stale account.
    if (
      policy.agent.sessionKeyPath !== signerSessionKeyPath ||
      policy.agent.kernelAddress.toLowerCase() !== signerKernelAddress.toLowerCase()
    ) {
      try {
        signer = await buildDaemonSigner(
          policy.agent.sessionKeyPath,
          policy.agent.kernelAddress,
          rpcUrl,
          bundlerUrl,
        );
        signerSessionKeyPath = policy.agent.sessionKeyPath;
        signerKernelAddress = policy.agent.kernelAddress;
        emit({
          type: "agent.signer-rotated",
          ts: new Date().toISOString(),
          iter: tickCount,
          sessionKeyPath: signerSessionKeyPath,
          kernelAddress: signerKernelAddress,
        });
      } catch (err) {
        emit({
          type: "tick.error",
          ts: new Date().toISOString(),
          iter: tickCount,
          intentId: "(signer-rebuild)",
          message: err instanceof Error ? err.message : String(err),
        });
        await sleepUntilNext();
        continue;
      }
    }

    const now = Math.floor(Date.now() / 1000);
    emit({
      type: "tick.start",
      ts: new Date().toISOString(),
      iter: tickCount,
      policyHash: hashPolicy(policy),
    });

    const constraintCheck = applyConstraints(policy, state, now);
    if (!constraintCheck.ok) {
      emit({
        type: "tick.skipped",
        ts: new Date().toISOString(),
        iter: tickCount,
        reason: constraintCheck.reason,
      });
      await sleepUntilNext();
      continue;
    }
    if (constraintCheck.resetDailySpend) {
      state = { ...state, dayStart: utcDayStart(now), spentUsdToday: 0 };
    }

    const pick = pickNextIntent(policy, state);
    if (!pick) {
      emit({
        type: "tick.skipped",
        ts: new Date().toISOString(),
        iter: tickCount,
        reason: "no-enabled-intent",
      });
      await sleepUntilNext();
      continue;
    }
    state = { ...state, intentCursor: pick.nextCursor };

    let result: OrchestrateResult | null = null;
    let success = false;
    let errMsg: string | null = null;
    try {
      const tokenIn = resolveToken(pick.intent.tokenIn);
      const tokenOut = resolveToken(pick.intent.tokenOut);
      const amount = parseUnits(pick.intent.amount, tokenIn.decimals);
      result = await orchestrate({
        recipientEns: pick.intent.recipient,
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        amount,
        signer,
        callerEns: policy.agent.ensName,
        tradingClient,
        oracleClient,
        routerAddress: process.env.TRUST_SWAP_ROUTER_ADDRESS as Address | undefined,
        dryRun: false,
      });
      success = !result.haltedAt && !!result.txHash;
    } catch (err) {
      errMsg = err instanceof Error ? err.message : String(err);
    }

    if (errMsg) {
      emit({
        type: "tick.error",
        ts: new Date().toISOString(),
        iter: tickCount,
        intentId: pick.intent.id,
        message: errMsg,
      });
      state = {
        ...state,
        lastSwapAt: now,
        consecutiveFailures: state.consecutiveFailures + 1,
      };
    } else if (result) {
      emit({
        type: "tick.swap",
        ts: new Date().toISOString(),
        iter: tickCount,
        intentId: pick.intent.id,
        recipient: pick.intent.recipient,
        tokenIn: pick.intent.tokenIn,
        tokenOut: pick.intent.tokenOut,
        amount: pick.intent.amount,
        txHash: result.txHash,
        decision: result.decision.allow ? "allow" : "deny",
        haltedAt: result.haltedAt,
        reason: result.onboardingHint,
        durationMs: Date.now() - tickStartedAt,
        success,
      });
      state = {
        ...state,
        lastSwapAt: now,
        consecutiveFailures: success ? 0 : state.consecutiveFailures + 1,
        spentUsdToday: success
          ? state.spentUsdToday + estimateSwapUsd(pick.intent, result)
          : state.spentUsdToday,
      };
    }

    if (state.consecutiveFailures >= policy.constraints.haltOnConsecutiveFailures) {
      state = { ...state, halted: true };
      emit({
        type: "agent.halted",
        ts: new Date().toISOString(),
        iter: tickCount,
        consecutiveFailures: state.consecutiveFailures,
      });
    }

    await sleepUntilNext();
  }

  if (!shuttingDown) shutdown("max-iterations");
  // Give the status server a moment to drain before the process exits
  await sleep(50);
}

/**
 * Abortable sleep. When `signal` aborts mid-flight (e.g. SIGTERM/SIGINT),
 * the timer is cleared and the promise resolves immediately so the loop
 * can drop into shutdown without waiting out a full `intervalSec`.
 * Resolving (rather than rejecting) keeps callers from needing try/catch
 * around every `await sleep(...)`.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Cheap stable hash for the policy — sequence number + length is enough to
 * detect "did the policy change this tick" in JSONL without dragging in a
 * crypto hash dep. Safe because the daemon emits the full policy at start
 * and OpenClaw edits are observable via this changing.
 */
function hashPolicy(p: OperatingPolicy): string {
  const s = JSON.stringify(p);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `len${s.length}:${(h >>> 0).toString(16)}`;
}

/** Stable USD-pegged tokens we can read 1:1 against `maxDailySpendUsd`. */
const STABLE_USD_DECIMALS: Readonly<Record<string, number>> = {
  USDC: 6,
  USDT: 6,
  DAI: 18,
};

/**
 * USD value of a completed swap, used to drive the `maxDailySpendUsd`
 * counter. Two cases produce a real number:
 *
 *   1. Stable-coin input — the intent's `amount` is already USD.
 *   2. Stable-coin output — read the realized output amount from
 *      `result.quote` and scale by the stable's decimals. Covers
 *      WETH→USDC, the shipped sample policy, so the daily cap actually
 *      bounds non-stable inputs.
 *
 * Anything else (non-stable both sides) returns 0 — a known under-count.
 * The on-chain RiskPolicy + session-key spend cap still bound each swap,
 * so this is a soft over-cap rather than the only line of defense.
 */
export function estimateSwapUsd(
  intent: OperatingPolicyIntent,
  result: OrchestrateResult | null = null,
): number {
  const tokenInUpper = String(intent.tokenIn).toUpperCase();
  if (tokenInUpper in STABLE_USD_DECIMALS) {
    return Number(intent.amount);
  }
  const tokenOutUpper = String(intent.tokenOut).toUpperCase();
  const outDecimals = STABLE_USD_DECIMALS[tokenOutUpper];
  if (outDecimals !== undefined && result?.quote) {
    const outRaw = getOutputAmount(result.quote);
    const parsed = Number(outRaw);
    if (Number.isFinite(parsed)) {
      return parsed / 10 ** outDecimals;
    }
  }
  return 0;
}
