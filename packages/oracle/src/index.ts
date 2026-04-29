import { Hono } from "hono";
import type { Address, Hex } from "viem";

// ---------------------------------------------------------------------------
// Public types
//
// `packages/core/orchestrate.ts` imports these from `@trust-swap/oracle` to
// type the response of `POST /attest`. The on-chain `TrustSwapRouter` accepts
// the same shape (re-encoded in Solidity) as input to `gatedSwap()`.
// ---------------------------------------------------------------------------

export type TrustTier =
  | "none"
  | "registered"
  | "discoverable"
  | "verified"
  | "full";

export interface AttestRequest {
  swapper: Address;
  recipient: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
}

export interface Attestation {
  swapper: Address;
  recipient: Address;
  swapperTier: TrustTier;
  recipientTier: TrustTier;
  /** Unix timestamp in seconds; the router rejects attestations past this. */
  expiresAt: number;
  /** Per-swapper nonce; the router stores the highest seen and rejects replays. */
  nonce: number;
}

export interface AttestResponse {
  attestation: Attestation;
  /** secp256k1 signature over `keccak256(abi.encode(attestation))` by ORACLE_PRIVATE_KEY. */
  signature: Hex;
}

export interface AttestErrorResponse {
  error: string;
  /** Optional onboarding hint for tier=none refusals. */
  hint?: string;
}

// ---------------------------------------------------------------------------
// Worker
//
// Phase 1 mock: returns a stub attestation with placeholder tiers and an
// all-zero signature. Phase 2 wires:
//   1. `@synthesis/resolver`.resolve() for both sides → tier
//   2. `resolveRiskPolicy()` for both sides → bidirectional check
//   3. tier=none refusal with onboarding hint
//   4. real secp256k1 signing with `env.ORACLE_PRIVATE_KEY`
// ---------------------------------------------------------------------------

interface Env {
  ORACLE_PRIVATE_KEY?: string;
  ORACLE_PUBKEY_ADDRESS?: string;
}

const PLACEHOLDER_SIGNATURE: Hex = `0x${"00".repeat(65)}` as Hex;

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) =>
  c.text(
    "trust-swap-oracle — Phase 1 mocked. POST /attest with { swapper, recipient, tokenIn, tokenOut, amountIn }.",
  ),
);

app.post("/attest", async (c) => {
  let body: AttestRequest;
  try {
    body = await c.req.json<AttestRequest>();
  } catch {
    return c.json<AttestErrorResponse>({ error: "invalid JSON body" }, 400);
  }

  const missing = (
    ["swapper", "recipient", "tokenIn", "tokenOut", "amountIn"] as const
  ).filter((k) => !body[k]);
  if (missing.length > 0) {
    return c.json<AttestErrorResponse>(
      { error: `missing required fields: ${missing.join(", ")}` },
      400,
    );
  }

  // Phase 1 mock: pretend both sides resolved as `verified` with no
  // RiskPolicy mismatches. Phase 2 replaces this with real TRL resolution.
  const response: AttestResponse = {
    attestation: {
      swapper: body.swapper,
      recipient: body.recipient,
      swapperTier: "verified",
      recipientTier: "verified",
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      nonce: Math.floor(Math.random() * 0xffffffff),
    },
    signature: PLACEHOLDER_SIGNATURE,
  };
  return c.json(response);
});

export default app;
