import { describe, expect, it, vi } from "vitest";
import type {
  ClassicQuote,
  OperatingPolicy,
  OrchestrateResult,
  OracleClient,
  TradingClient,
} from "@trust-swap/core";
import type { Signer } from "@synthesis/resolver";
import {
  type AgentEvent,
  type ExecutePeerPollDeps,
  applyConstraints,
  buildIntentsResponse,
  estimateSwapUsd,
  executePeerPoll,
  executeRegularTick,
  formatJsonl,
  initialAgentState,
  parseStatusBind,
  pickNextIntent,
  sleep,
  utcDayStart,
} from "./agent.js";
import type { PeerPollResult } from "./agent-peer-poll.js";

const KERNEL = "0x522D9d15D425E2b819f8963A10596eADCB19255d";

function basePolicy(overrides: Partial<OperatingPolicy> = {}): OperatingPolicy {
  return {
    version: 1,
    agent: {
      ensName: "daemon.test.eth",
      kernelAddress: KERNEL,
      sessionKeyPath: "~/.synthesis/daemon-session-key.json",
    },
    schedule: { intervalSec: 60 },
    intents: [
      {
        id: "a",
        kind: "swap",
        tokenIn: "USDC",
        tokenOut: "WETH",
        amount: "10",
        recipient: "kernel.test.eth",
        enabled: true,
      },
      {
        id: "b",
        kind: "swap",
        tokenIn: "USDC",
        tokenOut: "DAI",
        amount: "5",
        recipient: "kernel.test.eth",
        enabled: true,
      },
    ],
    constraints: {
      maxDailySpendUsd: 50,
      minSecondsBetweenSwaps: 30,
      haltOnConsecutiveFailures: 3,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe("utcDayStart", () => {
  it("rounds to UTC midnight", () => {
    // 2026-04-30T15:59:00Z → 2026-04-30T00:00:00Z
    const tNoon = Math.floor(Date.parse("2026-04-30T15:59:00Z") / 1000);
    const tMidnight = Math.floor(Date.parse("2026-04-30T00:00:00Z") / 1000);
    expect(utcDayStart(tNoon)).toBe(tMidnight);
  });
});

// ---------------------------------------------------------------------------

describe("pickNextIntent", () => {
  it("returns null when no intents are enabled", () => {
    const p = basePolicy();
    for (const i of p.intents) i.enabled = false;
    const state = initialAgentState(0);
    expect(pickNextIntent(p, state)).toBeNull();
  });

  it("returns the first enabled intent at cursor", () => {
    const p = basePolicy();
    const state = { ...initialAgentState(0), intentCursor: 0 };
    const pick = pickNextIntent(p, state);
    expect(pick?.intent.id).toBe("a");
    expect(pick?.nextCursor).toBe(1);
  });

  it("round-robins past disabled intents", () => {
    const p = basePolicy();
    const [first] = p.intents;
    if (first) first.enabled = false;
    const state = { ...initialAgentState(0), intentCursor: 0 };
    const pick = pickNextIntent(p, state);
    expect(pick?.intent.id).toBe("b");
    // After picking 'b' at index 1, nextCursor wraps to 0
    expect(pick?.nextCursor).toBe(0);
  });

  it("returns null on an empty intents array", () => {
    const p = basePolicy({ intents: [] });
    expect(pickNextIntent(p, initialAgentState(0))).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("applyConstraints", () => {
  const NOW = Math.floor(Date.parse("2026-04-30T12:00:00Z") / 1000);

  it("ok on a fresh state", () => {
    expect(applyConstraints(basePolicy(), initialAgentState(NOW), NOW)).toEqual({
      ok: true,
      resetDailySpend: false,
    });
  });

  it("blocks when halted", () => {
    const state = { ...initialAgentState(NOW), halted: true };
    const r = applyConstraints(basePolicy(), state, NOW);
    expect(r).toEqual({ ok: false, reason: "halted-on-consecutive-failures" });
  });

  it("blocks before schedule.startAt", () => {
    const p = basePolicy();
    p.schedule.startAt = "2026-05-01T00:00:00Z";
    expect(applyConstraints(p, initialAgentState(NOW), NOW)).toEqual({
      ok: false,
      reason: "schedule-not-yet-started",
    });
  });

  it("blocks after schedule.endAt", () => {
    const p = basePolicy();
    p.schedule.endAt = "2026-04-29T00:00:00Z";
    expect(applyConstraints(p, initialAgentState(NOW), NOW)).toEqual({
      ok: false,
      reason: "schedule-already-ended",
    });
  });

  it("blocks when last swap was within minSecondsBetweenSwaps", () => {
    const state = { ...initialAgentState(NOW), lastSwapAt: NOW - 10 };
    expect(applyConstraints(basePolicy(), state, NOW)).toEqual({
      ok: false,
      reason: "min-seconds-between-swaps",
    });
  });

  it("ok when last swap was past minSecondsBetweenSwaps", () => {
    const state = { ...initialAgentState(NOW), lastSwapAt: NOW - 60 };
    const r = applyConstraints(basePolicy(), state, NOW);
    expect(r.ok).toBe(true);
  });

  it("blocks when daily spend already at cap", () => {
    const state = { ...initialAgentState(NOW), spentUsdToday: 50 };
    expect(applyConstraints(basePolicy(), state, NOW)).toEqual({
      ok: false,
      reason: "max-daily-spend",
    });
  });

  it("signals resetDailySpend when day has rolled over", () => {
    const yesterday = NOW - 86400 - 100;
    const state = {
      ...initialAgentState(yesterday),
      spentUsdToday: 50, // would have blocked yesterday
    };
    const r = applyConstraints(basePolicy(), state, NOW);
    expect(r).toEqual({ ok: true, resetDailySpend: true });
  });
});

// ---------------------------------------------------------------------------

describe("formatJsonl", () => {
  it("serializes a tick.swap event without trailing newline", () => {
    const line = formatJsonl({
      type: "tick.swap",
      ts: "2026-04-30T12:00:00.000Z",
      iter: 1,
      intentId: "a",
      recipient: "kernel.test.eth",
      tokenIn: "USDC",
      tokenOut: "WETH",
      amount: "10",
      decision: "allow",
      durationMs: 1234,
      success: true,
    });
    expect(line).toBe(
      JSON.stringify({
        type: "tick.swap",
        ts: "2026-04-30T12:00:00.000Z",
        iter: 1,
        intentId: "a",
        recipient: "kernel.test.eth",
        tokenIn: "USDC",
        tokenOut: "WETH",
        amount: "10",
        decision: "allow",
        durationMs: 1234,
        success: true,
      }),
    );
    expect(line.includes("\n")).toBe(false);
  });

  it("round-trips through JSON.parse", () => {
    const event = {
      type: "agent.start" as const,
      ts: "2026-04-30T12:00:00.000Z",
      ensName: "daemon.test.eth",
      kernelAddress: KERNEL,
      policy: "/srv/trust-swap/policy.json",
      iterations: "unbounded" as const,
    };
    expect(JSON.parse(formatJsonl(event))).toEqual(event);
  });
});

// ---------------------------------------------------------------------------

describe("estimateSwapUsd", () => {
  const baseIntent = basePolicy().intents[0]!;

  function classicQuoteResult(outputAmount: string): OrchestrateResult {
    const quote: ClassicQuote = {
      routing: "CLASSIC",
      quote: {
        input: {
          token: "0x4200000000000000000000000000000000000006",
          amount: "1000000000000000000",
        },
        output: {
          token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          amount: outputAmount,
        },
        slippage: 50,
        gasFee: "0",
        gasFeeUSD: "0",
        gasUseEstimate: "0",
        route: [],
      },
      permitData: null,
    };
    return {
      decision: { allow: true } as OrchestrateResult["decision"],
      recipientProfile: {} as OrchestrateResult["recipientProfile"],
      recipientRiskPolicy: null,
      quote,
    };
  }

  it("returns intent.amount when tokenIn is a stablecoin (no result needed)", () => {
    expect(estimateSwapUsd({ ...baseIntent, tokenIn: "USDC", amount: "10" })).toBe(10);
    expect(estimateSwapUsd({ ...baseIntent, tokenIn: "DAI", amount: "5" })).toBe(5);
    expect(estimateSwapUsd({ ...baseIntent, tokenIn: "USDT", amount: "2.5" })).toBe(2.5);
  });

  it("uses the classic quote's stable-output amount for non-stable inputs", () => {
    // 3,500 USDC out (6 decimals) for a WETH→USDC swap → $3500
    const result = classicQuoteResult("3500000000");
    const usd = estimateSwapUsd(
      { ...baseIntent, tokenIn: "WETH", tokenOut: "USDC", amount: "1" },
      result,
    );
    expect(usd).toBe(3500);
  });

  it("returns 0 when neither side is a stablecoin", () => {
    const result = classicQuoteResult("12345");
    const usd = estimateSwapUsd(
      { ...baseIntent, tokenIn: "WETH", tokenOut: "WBTC", amount: "1" },
      result,
    );
    expect(usd).toBe(0);
  });

  it("returns 0 when tokenOut is a stablecoin but result is missing", () => {
    const usd = estimateSwapUsd(
      { ...baseIntent, tokenIn: "WETH", tokenOut: "USDC", amount: "1" },
      null,
    );
    expect(usd).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("sleep (abortable)", () => {
  it("resolves immediately when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const start = Date.now();
    await sleep(60_000, ac.signal);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("resolves promptly when the signal aborts mid-sleep", async () => {
    const ac = new AbortController();
    const start = Date.now();
    const p = sleep(60_000, ac.signal);
    setTimeout(() => ac.abort(), 5);
    await p;
    expect(Date.now() - start).toBeLessThan(100);
  });

  it("waits the full duration when no signal is supplied", async () => {
    const start = Date.now();
    await sleep(40);
    expect(Date.now() - start).toBeGreaterThanOrEqual(35);
  });
});

// ---------------------------------------------------------------------------

describe("parseStatusBind", () => {
  it("parses an IPv4 host:port", () => {
    expect(parseStatusBind("127.0.0.1:18790")).toEqual({
      host: "127.0.0.1",
      port: 18790,
    });
  });

  it("parses a bracketed IPv6 host:port", () => {
    expect(parseStatusBind("[fd7a:115c:a1e0::1]:18790")).toEqual({
      host: "fd7a:115c:a1e0::1",
      port: 18790,
    });
  });

  it("parses [::1]:port (IPv6 loopback)", () => {
    expect(parseStatusBind("[::1]:18790")).toEqual({ host: "::1", port: 18790 });
  });

  it("rejects an empty host (`:18790`)", () => {
    expect(() => parseStatusBind(":18790")).toThrow(/empty host/);
  });

  it("rejects an empty port (`host:`)", () => {
    expect(() => parseStatusBind("host:")).toThrow(/empty port/);
  });

  it("rejects an out-of-range port (`host:99999`)", () => {
    expect(() => parseStatusBind("host:99999")).toThrow(/out of range/);
  });

  it("rejects a non-numeric port (`host:abc`)", () => {
    expect(() => parseStatusBind("host:abc")).toThrow(/non-numeric port/);
  });

  it("rejects an unterminated IPv6 bracket", () => {
    expect(() => parseStatusBind("[::1:18790")).toThrow(/unterminated IPv6 bracket/);
  });

  it("rejects bracketed IPv6 missing the `:port` separator", () => {
    expect(() => parseStatusBind("[::1]18790")).toThrow(/expected ":port" after "\]"/);
  });
});

describe("buildIntentsResponse", () => {
  const FROZEN_NOW = new Date("2026-05-01T22:30:00.000Z");

  it("returns the agent identity + only enabled intents", () => {
    const policy = basePolicy({
      listen: {
        peers: ["daemon.peer.eth"],
        pollIntervalSec: 30,
        maxConcurrentIntents: 2,
      },
      intents: [
        {
          id: "live",
          kind: "swap",
          tokenIn: "USDC",
          tokenOut: "WETH",
          amount: "10",
          recipient: "kernel.test.eth",
          enabled: true,
        },
        {
          id: "draft",
          kind: "swap",
          tokenIn: "USDC",
          tokenOut: "DAI",
          amount: "5",
          recipient: "kernel.test.eth",
          enabled: false,
        },
      ],
    });
    const res = buildIntentsResponse(policy, FROZEN_NOW);
    expect(res).toEqual({
      ensName: "daemon.test.eth",
      kernelAddress: KERNEL,
      listedAt: "2026-05-01T22:30:00.000Z",
      intents: [
        {
          id: "live",
          kind: "swap",
          tokenIn: "USDC",
          tokenOut: "WETH",
          amount: "10",
          recipient: "kernel.test.eth",
        },
      ],
    });
  });

  it("returns an empty intents array when nothing is enabled", () => {
    const policy = basePolicy({
      intents: [
        {
          id: "a",
          kind: "swap",
          tokenIn: "USDC",
          tokenOut: "WETH",
          amount: "10",
          recipient: "kernel.test.eth",
          enabled: false,
        },
      ],
    });
    const res = buildIntentsResponse(policy, FROZEN_NOW);
    expect(res.intents).toEqual([]);
  });

  it("does not leak the cron field — only the swap shape peers can act on", () => {
    const policy = basePolicy({
      intents: [
        {
          id: "a",
          kind: "swap",
          tokenIn: "USDC",
          tokenOut: "WETH",
          amount: "10",
          recipient: "kernel.test.eth",
          cron: "*/5 * * * *",
          enabled: true,
        },
      ],
    });
    const res = buildIntentsResponse(policy, FROZEN_NOW);
    expect(res.intents[0]).not.toHaveProperty("cron");
    expect(res.intents[0]).not.toHaveProperty("enabled");
  });
});

// ---------------------------------------------------------------------------
// TRU-87: peer-poll runs every iteration. The pre-fix loop body had two
// `continue` statements (constraint-blocked tick + no-enabled-intent tick)
// that skipped past the peer-poll block, so the daemon only ever fulfilled
// peer matches when the kernel could fund TWO swaps per tick. The hoisted
// helpers below let us drive the new ordering deterministically without
// spinning up a real signer / orchestrate / fetch.
// ---------------------------------------------------------------------------

const FAKE_SIGNER = {
  address: "0x0000000000000000000000000000000000000000",
  execute: async () => "0x0",
} as unknown as Signer;

function fakePeerPollDeps(
  over: Partial<ExecutePeerPollDeps> = {},
): ExecutePeerPollDeps {
  return {
    policy: listenPolicy(),
    signer: FAKE_SIGNER,
    tradingClient: {} as TradingClient,
    oracleClient: {} as OracleClient,
    emit: () => {},
    tickCount: 1,
    shuttingDown: () => false,
    ...over,
  };
}

function listenPolicy(over: Partial<OperatingPolicy> = {}): OperatingPolicy {
  return basePolicy({
    listen: {
      peers: ["daemon.peer.eth"],
      pollIntervalSec: 30,
      maxConcurrentIntents: 4,
    },
    ...over,
  });
}

function emptyPeerOk(peer = "daemon.peer.eth"): PeerPollResult {
  return {
    peerEnsName: peer,
    outcome: {
      kind: "ok",
      body: {
        ensName: peer,
        kernelAddress: KERNEL,
        listedAt: "2026-05-02T12:00:00Z",
        intents: [],
      },
    },
    evaluations: [],
  };
}

function okOrchestrateResult(): OrchestrateResult {
  return {
    decision: { allow: true } as OrchestrateResult["decision"],
    recipientProfile: {} as OrchestrateResult["recipientProfile"],
    recipientRiskPolicy: null,
    txHash: "0xabc" as `0x${string}`,
  } as unknown as OrchestrateResult;
}

describe("executePeerPoll (TRU-87 hoisted peer-poll)", () => {
  const NOW_SEC = Math.floor(Date.parse("2026-05-02T12:00:00Z") / 1000);
  const NOW_MS = NOW_SEC * 1000;

  it("fires pollPeers when no local intent is enabled (the TRU-87 lockout case)", async () => {
    const events: AgentEvent[] = [];
    const policy = listenPolicy({
      intents: [
        {
          id: "x",
          kind: "swap",
          tokenIn: "USDC",
          tokenOut: "WETH",
          amount: "1",
          recipient: "kernel.test.eth",
          enabled: false,
        },
      ],
    });
    const pollPeersFn = vi.fn(async () => [emptyPeerOk()]);
    const orchestrateFn = vi.fn();

    await executePeerPoll(
      initialAgentState(NOW_SEC),
      0,
      NOW_MS,
      fakePeerPollDeps({
        policy,
        emit: (e) => events.push(e),
        pollPeersFn,
        orchestrateFn,
      }),
    );

    expect(pollPeersFn).toHaveBeenCalledTimes(1);
    expect(events.find((e) => e.type === "peer.poll")).toBeDefined();
    expect(orchestrateFn).not.toHaveBeenCalled();
  });

  it("fires pollPeers after a constraint-blocked regular tick (halted state)", async () => {
    const events: AgentEvent[] = [];
    const haltedState = { ...initialAgentState(NOW_SEC), halted: true };
    const pollPeersFn = vi.fn(async () => [emptyPeerOk()]);
    const orchestrateFn = vi.fn();

    await executePeerPoll(
      haltedState,
      0,
      NOW_MS,
      fakePeerPollDeps({
        emit: (e) => events.push(e),
        pollPeersFn,
        orchestrateFn,
      }),
    );

    expect(pollPeersFn).toHaveBeenCalledTimes(1);
    expect(events.find((e) => e.type === "peer.poll")).toBeDefined();
    // Halted state still propagates through to settlement guards (proved
    // separately in the back-to-back test below).
  });

  it("min-seconds-between-swaps blocks the second of two back-to-back peer settles", async () => {
    const events: AgentEvent[] = [];
    const peerIntents = [
      {
        id: "p1",
        kind: "swap" as const,
        tokenIn: "USDC",
        tokenOut: "WETH",
        amount: "1",
        recipient: "kernel.peer.eth",
      },
      {
        id: "p2",
        kind: "swap" as const,
        tokenIn: "USDC",
        tokenOut: "WETH",
        amount: "1",
        recipient: "kernel.peer.eth",
      },
    ];
    const pollPeersFn = vi.fn(async (): Promise<ReadonlyArray<PeerPollResult>> => [
      {
        peerEnsName: "daemon.peer.eth",
        outcome: {
          kind: "ok",
          body: {
            ensName: "daemon.peer.eth",
            kernelAddress: KERNEL,
            listedAt: "2026-05-02T12:00:00Z",
            intents: peerIntents,
          },
        },
        evaluations: peerIntents.map((p) => ({
          peerIntent: p,
          evaluation: {
            decision: "match" as const,
            reason: 'matches local intent "a"',
            matchedLocalIntentId: "a",
          },
        })),
      },
    ]);
    const orchestrateFn = vi.fn(async () => okOrchestrateResult());

    await executePeerPoll(
      initialAgentState(NOW_SEC),
      0,
      NOW_MS,
      fakePeerPollDeps({
        emit: (e) => events.push(e),
        pollPeersFn,
        orchestrateFn,
      }),
    );

    // First match settled; second hit the per-match constraint re-check
    expect(orchestrateFn).toHaveBeenCalledTimes(1);
    const skipped = events.find((e) => e.type === "peer.intent-skipped");
    expect(skipped).toBeDefined();
    if (skipped?.type === "peer.intent-skipped") {
      expect(skipped.reason).toBe("min-seconds-between-swaps");
      expect(skipped.peerIntentId).toBe("p2");
    }
    expect(events.filter((e) => e.type === "peer.intent-settled")).toHaveLength(1);
  });

  it("respects pollIntervalSec — no fetch before the next due time", async () => {
    const events: AgentEvent[] = [];
    const pollPeersFn = vi.fn(async () => [emptyPeerOk()]);

    // lastPeerPollAt = NOW_MS, pollIntervalSec = 30, so we're not due yet
    const result = await executePeerPoll(
      initialAgentState(NOW_SEC),
      NOW_MS,
      NOW_MS + 5_000,
      fakePeerPollDeps({
        emit: (e) => events.push(e),
        pollPeersFn,
      }),
    );

    expect(pollPeersFn).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
    expect(result.lastPeerPollAt).toBe(NOW_MS);
  });
});

describe("executeRegularTick (TRU-87 — runs the regular intent path)", () => {
  const NOW_SEC = Math.floor(Date.parse("2026-05-02T12:00:00Z") / 1000);

  it("emits tick.swap when a local intent fires successfully", async () => {
    const events: AgentEvent[] = [];
    const orchestrateFn = vi.fn(async () => okOrchestrateResult());

    const out = await executeRegularTick(
      initialAgentState(NOW_SEC),
      NOW_SEC,
      {
        policy: basePolicy(),
        signer: FAKE_SIGNER,
        tradingClient: {} as TradingClient,
        oracleClient: {} as OracleClient,
        emit: (e) => events.push(e),
        tickCount: 1,
        tickStartedAt: Date.now(),
        orchestrateFn,
      },
    );

    expect(orchestrateFn).toHaveBeenCalledTimes(1);
    const swap = events.find((e) => e.type === "tick.swap");
    expect(swap).toBeDefined();
    if (swap?.type === "tick.swap") {
      expect(swap.intentId).toBe("a");
      expect(swap.success).toBe(true);
      expect(swap.decision).toBe("allow");
    }
    expect(out.lastSwapAt).toBe(NOW_SEC);
    expect(out.consecutiveFailures).toBe(0);
  });

  it("emits tick.skipped (no-enabled-intent) without calling orchestrate", async () => {
    const events: AgentEvent[] = [];
    const orchestrateFn = vi.fn();
    const policy = basePolicy({
      intents: [
        {
          id: "a",
          kind: "swap",
          tokenIn: "USDC",
          tokenOut: "WETH",
          amount: "10",
          recipient: "kernel.test.eth",
          enabled: false,
        },
      ],
    });

    await executeRegularTick(initialAgentState(NOW_SEC), NOW_SEC, {
      policy,
      signer: FAKE_SIGNER,
      tradingClient: {} as TradingClient,
      oracleClient: {} as OracleClient,
      emit: (e) => events.push(e),
      tickCount: 1,
      tickStartedAt: Date.now(),
      orchestrateFn,
    });

    expect(orchestrateFn).not.toHaveBeenCalled();
    const skipped = events.find((e) => e.type === "tick.skipped");
    expect(skipped).toBeDefined();
    if (skipped?.type === "tick.skipped") {
      expect(skipped.reason).toBe("no-enabled-intent");
    }
  });
});
