import {
  resolve,
  type ResolveOptions,
  type TrustProfile,
} from "@synthesis/resolver";

// ---------------------------------------------------------------------------
// Resolver cache (TRU-75)
//
// Synthesis's `resolve()` fires 5 parallel ENS layer queries (Personhood,
// Identity, Context, Manifest, Skill). Under load against a public RPC
// (drpc.org especially) ~30% of calls return a *degraded* `TrustProfile`:
// `address: null`, `trustScore: "none"`, or `manifest.found: false` despite
// the on-chain records being correct on retry. For one-shot CLI swaps the
// flake is annoying but tolerable; for daemon poll loops + A2A negotiation
// (Phase 5/6) it dominates the audit log within an hour.
//
// This module wraps `resolve()` with an in-process cache:
//   • TTL — default 5 min, configurable per-call
//   • Skip caching flake-shaped profiles (tier=none, address=null) so a
//     bad first read doesn't pin the ENS into degraded state for 5 min
//   • Manual bypass via `bypassCache: true`
//   • Per-process state — no cross-Worker sharing (CF Workers reset
//     between invocations; CLI / daemon processes hold their own table)
//
// Use as a drop-in replacement for `resolve` wherever orchestrate-side
// retries are expensive (CLI hot path, daemon loops). The deployed oracle
// Worker is stateless across requests so the cache is moot there — but
// pointing the Worker at a sturdier RPC (Alchemy via `ETH_RPC_URL`) gets
// most of the win on that side.
// ---------------------------------------------------------------------------

interface CacheEntry {
  profile: TrustProfile;
  /** Unix ms when this entry expires. */
  expiresAt: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

const cache = new Map<string, CacheEntry>();

export interface CachedResolveOptions extends ResolveOptions {
  /** TTL for this lookup in milliseconds. Default 5 min. */
  ttlMs?: number;
  /** Force a cache miss (still populates on success). Default false. */
  bypassCache?: boolean;
  /** Clock override for tests. Returns Unix ms. */
  now?: () => number;
  /** Resolver injection for tests. Defaults to `@synthesis/resolver.resolve`. */
  resolveImpl?: typeof resolve;
}

/**
 * Resolve an ENS name through synthesis with a short-TTL cache layered
 * over the top. Drop-in replacement for `resolve(ensName, options)`.
 *
 * Cache key is the lowercased ENS name. Two different RPCs against the
 * same name share a cache entry — that's intentional, since the on-chain
 * records they return SHOULD agree.
 */
export async function cachedResolveTrustProfile(
  ensName: string,
  options: CachedResolveOptions = {},
): Promise<TrustProfile> {
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? (() => Date.now());
  const resolveFn = options.resolveImpl ?? resolve;
  const key = ensName.toLowerCase();

  if (!options.bypassCache) {
    const hit = cache.get(key);
    if (hit) {
      if (hit.expiresAt > now()) return hit.profile;
      // Stale entry — drop it on the floor before re-resolving so a
      // long-lived process resolving many distinct ENS names doesn't
      // accumulate dead Map entries indefinitely. (codex P2 #1 PR #6)
      cache.delete(key);
    }
  }

  // Strip cache-only options before forwarding to synthesis.
  const { ttlMs: _t, bypassCache: _b, now: _n, resolveImpl: _r, ...resolveOptions } =
    options;
  void _t;
  void _b;
  void _n;
  void _r;

  const profile = await resolveFn(ensName, resolveOptions);

  // Don't cache flake-shaped results. A genuine `tier=none` ENS will keep
  // re-resolving — that's fine, it'd gate-fail anyway and the resolve is
  // cheap. The point is to avoid pinning an ENS into a degraded read for
  // 5 min when the next attempt would have returned the right answer.
  if (isFlakeShape(profile)) return profile;

  cache.set(key, { profile, expiresAt: now() + ttl });
  return profile;
}

/**
 * Profile shape that *probably* came from a synthesis layer race rather
 * than a real on-chain state. Conservative: only the most reliable flake
 * signatures (null address, tier=none). False negatives (real none-tier
 * ENS) are fine — they just don't get cached, which is harmless.
 */
function isFlakeShape(profile: TrustProfile): boolean {
  if (profile.trustScore === "none") return true;
  if (!profile.address) return true;
  return false;
}

/** Inspect the cache (testing / diagnostics). Returns a snapshot. */
export function getResolverCacheSnapshot(): Array<{
  ensName: string;
  trustScore: string;
  expiresAt: number;
}> {
  return Array.from(cache.entries()).map(([ensName, entry]) => ({
    ensName,
    trustScore: entry.profile.trustScore,
    expiresAt: entry.expiresAt,
  }));
}

/** Drop all cached entries. Useful for tests + manual flush. */
export function clearResolverCache(): void {
  cache.clear();
}
