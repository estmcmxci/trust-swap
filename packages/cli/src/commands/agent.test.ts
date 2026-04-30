import { describe, expect, it } from "vitest";
import type { ClassicQuote, OperatingPolicy, OrchestrateResult } from "@trust-swap/core";
import {
  applyConstraints,
  estimateSwapUsd,
  formatJsonl,
  initialAgentState,
  pickNextIntent,
  sleep,
  utcDayStart,
} from "./agent.js";

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
