import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Address } from "viem";
import type { TrustProfile, TrustTier } from "@synthesis/resolver";
import {
  cachedResolveTrustProfile,
  clearResolverCache,
  getResolverCacheSnapshot,
} from "./resolver-cache.js";

const ADDR = "0x1111111111111111111111111111111111111111" as Address;

function makeProfile(overrides: Partial<TrustProfile> = {}): TrustProfile {
  // Minimum shape `cachedResolveTrustProfile` cares about. The cache only
  // peeks at `address` and `trustScore`; the rest is opaque pass-through.
  return {
    ensName: "alice.eth",
    address: ADDR,
    resolvedAt: 0,
    trustScore: "verified" as TrustTier,
    personhood: {
      verified: true,
      nullifierHash: null,
      network: null,
      agentBookAddress: null,
    },
    identity: {
      verified: true,
      registryAddress: null,
      agentId: null,
      registryChain: null,
      tokenURI: null,
      owner: null,
    },
    context: { found: false, raw: null, parsed: null, skillUrl: null },
    manifest: {
      found: true,
      latestVersion: null,
      lineageMode: null,
      manifest: null,
      signatureValid: true,
      lineageDepth: 0,
      lineageIntact: true,
    },
    skill: {
      found: false,
      manifestUrl: null,
      manifest: null,
      signatureValid: false,
    },
    ...overrides,
  } as TrustProfile;
}

describe("cachedResolveTrustProfile (TRU-75)", () => {
  beforeEach(() => {
    clearResolverCache();
  });

  it("caches successful resolves across calls", async () => {
    const profile = makeProfile();
    const resolveImpl = vi.fn(async () => profile);

    const a = await cachedResolveTrustProfile("alice.eth", { resolveImpl });
    const b = await cachedResolveTrustProfile("alice.eth", { resolveImpl });

    expect(a).toBe(profile);
    expect(b).toBe(profile);
    expect(resolveImpl).toHaveBeenCalledTimes(1); // second call is a hit
  });

  it("re-resolves after TTL expires", async () => {
    const profile = makeProfile();
    const resolveImpl = vi.fn(async () => profile);
    let nowMs = 1_000_000;
    const now = () => nowMs;

    await cachedResolveTrustProfile("alice.eth", {
      resolveImpl,
      now,
      ttlMs: 1000,
    });
    nowMs += 999; // still within TTL
    await cachedResolveTrustProfile("alice.eth", {
      resolveImpl,
      now,
      ttlMs: 1000,
    });
    expect(resolveImpl).toHaveBeenCalledTimes(1);

    nowMs += 2; // past TTL (999 + 2 = 1001 elapsed)
    await cachedResolveTrustProfile("alice.eth", {
      resolveImpl,
      now,
      ttlMs: 1000,
    });
    expect(resolveImpl).toHaveBeenCalledTimes(2);
  });

  it("does NOT cache flake-shape (tier=none)", async () => {
    const flake = makeProfile({ trustScore: "none" as TrustTier });
    const real = makeProfile();
    const resolveImpl = vi.fn(async () => flake);
    resolveImpl.mockResolvedValueOnce(flake);
    resolveImpl.mockResolvedValueOnce(real);

    const a = await cachedResolveTrustProfile("alice.eth", { resolveImpl });
    expect(a.trustScore).toBe("none");
    expect(getResolverCacheSnapshot()).toHaveLength(0);

    // Second call must NOT see the cached flake — it should re-resolve and
    // get the real profile.
    const b = await cachedResolveTrustProfile("alice.eth", { resolveImpl });
    expect(b.trustScore).toBe("verified");
    expect(resolveImpl).toHaveBeenCalledTimes(2);
    // After the real resolve, the entry IS cached.
    expect(getResolverCacheSnapshot()).toHaveLength(1);
  });

  it("does NOT cache flake-shape (address null)", async () => {
    const flake = makeProfile({ address: null as unknown as Address });
    const resolveImpl = vi.fn(async () => flake);

    await cachedResolveTrustProfile("alice.eth", { resolveImpl });
    await cachedResolveTrustProfile("alice.eth", { resolveImpl });

    expect(resolveImpl).toHaveBeenCalledTimes(2); // both cache misses
    expect(getResolverCacheSnapshot()).toHaveLength(0);
  });

  it("bypassCache forces a re-resolve but still populates on success", async () => {
    const profile = makeProfile();
    const resolveImpl = vi.fn(async () => profile);

    await cachedResolveTrustProfile("alice.eth", { resolveImpl });
    await cachedResolveTrustProfile("alice.eth", {
      resolveImpl,
      bypassCache: true,
    });
    await cachedResolveTrustProfile("alice.eth", { resolveImpl });

    expect(resolveImpl).toHaveBeenCalledTimes(2); // call 3 hits the refreshed cache
  });

  it("ENS name is normalized to lowercase for the cache key", async () => {
    const profile = makeProfile();
    const resolveImpl = vi.fn(async () => profile);

    await cachedResolveTrustProfile("Alice.ETH", { resolveImpl });
    await cachedResolveTrustProfile("alice.eth", { resolveImpl });

    expect(resolveImpl).toHaveBeenCalledTimes(1);
  });

  it("evicts expired entries on read instead of letting them accumulate", async () => {
    // codex P2 #1 on PR #6 — long-lived processes resolving many distinct
    // ENS names should not leak Map entries indefinitely.
    const profile = makeProfile();
    const resolveImpl = vi.fn(async () => profile);
    let nowMs = 1_000_000;
    const now = () => nowMs;

    await cachedResolveTrustProfile("alice.eth", {
      resolveImpl,
      now,
      ttlMs: 1000,
    });
    expect(getResolverCacheSnapshot()).toHaveLength(1);

    // Move past TTL. Read with `bypassCache: false` — entry exists but is
    // stale; the cache hit branch must `delete` it before re-resolving.
    nowMs += 5000;
    await cachedResolveTrustProfile("alice.eth", {
      resolveImpl,
      now,
      ttlMs: 1000,
    });
    // The fresh resolve repopulated the entry, so snapshot length is 1
    // (not 2). The non-leak invariant: at most one entry per key, ever.
    expect(getResolverCacheSnapshot()).toHaveLength(1);
    // And the resolver fired twice (once initial, once after TTL).
    expect(resolveImpl).toHaveBeenCalledTimes(2);
  });
});
