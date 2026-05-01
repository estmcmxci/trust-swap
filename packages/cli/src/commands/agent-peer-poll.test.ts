import { describe, expect, it, vi } from "vitest";
import type { OperatingPolicy, OperatingPolicyIntent } from "@trust-swap/core";
import {
  IntentsResponseSchema,
  evaluatePeerIntent,
  fetchPeerIntents,
  pollPeers,
  type AdvertisedPeerIntent,
} from "./agent-peer-poll.js";

vi.mock("@trust-swap/core", async (orig) => {
  const actual = await orig<typeof import("@trust-swap/core")>();
  return {
    ...actual,
    resolveAgentEndpoint: vi.fn(),
  };
});

const { resolveAgentEndpoint } = await import("@trust-swap/core");
const mockedResolve = vi.mocked(resolveAgentEndpoint);

const KERNEL = "0x522D9d15D425E2b819f8963A10596eADCB19255d";

function intent(over: Partial<OperatingPolicyIntent> = {}): OperatingPolicyIntent {
  return {
    id: "local-1",
    kind: "swap",
    tokenIn: "USDC",
    tokenOut: "WETH",
    amount: "10",
    recipient: "kernel.test.eth",
    enabled: true,
    ...over,
  };
}

function peer(over: Partial<AdvertisedPeerIntent> = {}): AdvertisedPeerIntent {
  return {
    id: "peer-1",
    kind: "swap",
    tokenIn: "USDC",
    tokenOut: "WETH",
    amount: "1",
    recipient: "daemon.peer.eth",
    ...over,
  };
}

describe("evaluatePeerIntent", () => {
  it("matches when an enabled local intent shares the (tokenIn, tokenOut) pair", () => {
    const r = evaluatePeerIntent([intent({ id: "local-a" })], peer());
    expect(r.decision).toBe("match");
    expect(r.matchedLocalIntentId).toBe("local-a");
    expect(r.reason).toContain("local-a");
  });

  it("declines when no local intent matches the pair", () => {
    const r = evaluatePeerIntent(
      [intent({ tokenIn: "USDC", tokenOut: "DAI" })],
      peer({ tokenIn: "USDC", tokenOut: "WETH" }),
    );
    expect(r.decision).toBe("decline");
    expect(r.reason).toContain("USDC");
    expect(r.reason).toContain("WETH");
    expect(r.matchedLocalIntentId).toBeUndefined();
  });

  it("ignores disabled local intents", () => {
    const r = evaluatePeerIntent([intent({ enabled: false })], peer());
    expect(r.decision).toBe("decline");
  });

  it("compares token symbols case-insensitively", () => {
    const r = evaluatePeerIntent(
      [intent({ tokenIn: "usdc", tokenOut: "weth" })],
      peer({ tokenIn: "USDC", tokenOut: "WETH" }),
    );
    expect(r.decision).toBe("match");
  });

  it("returns the first matching intent when multiple share the pair", () => {
    const r = evaluatePeerIntent(
      [intent({ id: "first" }), intent({ id: "second" })],
      peer(),
    );
    expect(r.matchedLocalIntentId).toBe("first");
  });
});

describe("IntentsResponseSchema", () => {
  it("accepts the shape produced by /intents", () => {
    const payload = {
      ensName: "daemon.peer.eth",
      kernelAddress: KERNEL,
      listedAt: "2026-05-01T22:00:00.000Z",
      intents: [
        {
          id: "i1",
          kind: "swap",
          tokenIn: "USDC",
          tokenOut: "WETH",
          amount: "1",
          recipient: "daemon.peer.eth",
        },
      ],
    };
    const r = IntentsResponseSchema.safeParse(payload);
    expect(r.success).toBe(true);
  });

  it("rejects non-swap kinds — schema is intentionally tight", () => {
    const r = IntentsResponseSchema.safeParse({
      ensName: "x.eth",
      kernelAddress: KERNEL,
      listedAt: "2026-05-01T00:00:00Z",
      intents: [{ id: "i", kind: "transfer", tokenIn: "USDC", tokenOut: "WETH", amount: "1", recipient: "x.eth" }],
    });
    expect(r.success).toBe(false);
  });
});

describe("fetchPeerIntents", () => {
  it("returns no-endpoint when ENS has no agent-endpoint record", async () => {
    mockedResolve.mockResolvedValueOnce(null);
    const r = await fetchPeerIntents("ghost.eth");
    expect(r.kind).toBe("no-endpoint");
  });

  it("returns ok with parsed body on a 200", async () => {
    mockedResolve.mockResolvedValueOnce("http://peer.test");
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ensName: "peer.eth",
        kernelAddress: KERNEL,
        listedAt: "2026-05-01T22:00:00.000Z",
        intents: [],
      }),
    })) as unknown as typeof fetch;
    const r = await fetchPeerIntents("peer.eth", { fetchImpl });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.body.ensName).toBe("peer.eth");
      expect(r.body.intents).toEqual([]);
    }
  });

  it("appends /intents to the agent-endpoint base URL", async () => {
    // ENSIP-26 convention: `agent-endpoint` is a base URL the same way
    // resolveRiskPolicy treats it (`<endpoint>/policy`). This test pins
    // the contract so a regression to the raw-URL form would fail loudly.
    mockedResolve.mockResolvedValueOnce("http://peer.test:18791");
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ensName: "peer.eth",
        kernelAddress: KERNEL,
        listedAt: "2026-05-01T22:00:00.000Z",
        intents: [],
      }),
    })) as unknown as typeof fetch;
    await fetchPeerIntents("peer.eth", { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://peer.test:18791/intents",
      expect.any(Object),
    );
  });

  it("strips trailing slashes from the base URL before appending /intents", async () => {
    mockedResolve.mockResolvedValueOnce("http://peer.test:18791///");
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ensName: "peer.eth",
        kernelAddress: KERNEL,
        listedAt: "2026-05-01T22:00:00.000Z",
        intents: [],
      }),
    })) as unknown as typeof fetch;
    await fetchPeerIntents("peer.eth", { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://peer.test:18791/intents",
      expect.any(Object),
    );
  });

  it("returns fetch-failed on a non-2xx response", async () => {
    mockedResolve.mockResolvedValueOnce("http://peer.test/intents");
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    const r = await fetchPeerIntents("peer.eth", { fetchImpl });
    expect(r.kind).toBe("fetch-failed");
    if (r.kind === "fetch-failed") expect(r.message).toContain("503");
  });

  it("returns parse-failed when the body has the wrong shape", async () => {
    mockedResolve.mockResolvedValueOnce("http://peer.test/intents");
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ wrong: "shape" }),
    })) as unknown as typeof fetch;
    const r = await fetchPeerIntents("peer.eth", { fetchImpl });
    expect(r.kind).toBe("parse-failed");
  });
});

describe("pollPeers", () => {
  function basePolicy(over: Partial<OperatingPolicy> = {}): OperatingPolicy {
    return {
      version: 1,
      agent: {
        ensName: "daemon.test.eth",
        kernelAddress: KERNEL,
        sessionKeyPath: "~/x.json",
      },
      schedule: { intervalSec: 60 },
      intents: [intent({ id: "local-a" })],
      constraints: {
        maxDailySpendUsd: 50,
        minSecondsBetweenSwaps: 30,
        haltOnConsecutiveFailures: 3,
      },
      ...over,
    };
  }

  it("returns [] when policy.listen is absent", async () => {
    const r = await pollPeers(basePolicy());
    expect(r).toEqual([]);
  });

  it("evaluates each peer's intents and bounds by maxConcurrentIntents", async () => {
    const policy = basePolicy({
      listen: {
        peers: ["alice.eth", "bob.eth"],
        pollIntervalSec: 10,
        maxConcurrentIntents: 1,
      },
    });
    mockedResolve.mockImplementation(async (name: string) =>
      name === "alice.eth" ? "http://alice.test/intents" : "http://bob.test/intents",
    );
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("alice")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ensName: "alice.eth",
            kernelAddress: KERNEL,
            listedAt: "2026-05-01T22:00:00.000Z",
            // Two intents, but maxConcurrentIntents=1 should clamp to first
            intents: [peer({ id: "a1" }), peer({ id: "a2" })],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ensName: "bob.eth",
          kernelAddress: KERNEL,
          listedAt: "2026-05-01T22:00:00.000Z",
          intents: [peer({ id: "b1", tokenOut: "DAI" })],
        }),
      };
    }) as unknown as typeof fetch;
    const r = await pollPeers(policy, { fetchImpl });
    expect(r).toHaveLength(2);
    expect(r[0].peerEnsName).toBe("alice.eth");
    expect(r[0].evaluations).toHaveLength(1);
    expect(r[0].evaluations[0].peerIntent.id).toBe("a1");
    expect(r[0].evaluations[0].evaluation.decision).toBe("match");
    expect(r[1].peerEnsName).toBe("bob.eth");
    expect(r[1].evaluations[0].evaluation.decision).toBe("decline");
  });

  it("propagates a no-endpoint outcome with empty evaluations", async () => {
    const policy = basePolicy({
      listen: {
        peers: ["ghost.eth"],
        pollIntervalSec: 10,
        maxConcurrentIntents: 5,
      },
    });
    mockedResolve.mockResolvedValueOnce(null);
    const r = await pollPeers(policy, { fetchImpl: vi.fn() as unknown as typeof fetch });
    expect(r[0].outcome.kind).toBe("no-endpoint");
    expect(r[0].evaluations).toEqual([]);
  });
});
