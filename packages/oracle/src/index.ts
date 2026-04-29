import { Hono } from "hono";
import { z } from "zod";
import {
  encodeAbiParameters,
  isAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  resolve,
  type TrustProfile,
  type TrustTier,
} from "@synthesis/resolver";
import {
  resolveRiskPolicy,
  type Attestation,
  type AttestErrorResponse,
  type AttestResponse,
  type RiskPolicy,
} from "@trust-swap/core";

// ---------------------------------------------------------------------------
// Types & re-exports
//
// The wire types live in `@trust-swap/core/src/attestation.ts`; we re-export
// them here so existing consumers that imported from `@trust-swap/oracle`
// keep working. The runtime Hono app is the default export.
// ---------------------------------------------------------------------------

export type {
  AttestRequest,
  AttestResponse,
  Attestation,
  AttestErrorResponse,
} from "@trust-swap/core";
export type { TrustTier } from "@synthesis/resolver";

interface Env {
  ORACLE_PRIVATE_KEY?: string;
  ORACLE_PUBKEY_ADDRESS?: string;
  ETH_RPC_URL?: string;
}

const VERSION = "0.1.0-phase2";
const ATTESTATION_TTL_SECONDS = 300;

const TIER_INDEX: Record<TrustTier, number> = {
  none: 0,
  registered: 1,
  discoverable: 2,
  verified: 3,
  full: 4,
};

const TIER_RANK: Record<TrustTier, number> = TIER_INDEX;

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const AddressSchema = z
  .string()
  .refine((v) => isAddress(v), "must be a 0x-prefixed 20-byte address")
  .transform((v) => v as Address);

const AttestRequestSchema = z.object({
  swapperEns: z.string().min(3),
  recipientEns: z.string().min(3),
  swapper: AddressSchema,
  recipient: AddressSchema,
  tokenIn: AddressSchema,
  tokenOut: AddressSchema,
  amountIn: z
    .string()
    .regex(/^\d+$/, "amountIn must be a base-10 integer string"),
  // Reverse-direction RiskPolicy size check uses this against the
  // swapper's `maxAcceptedSize`. Optional for now so legacy mock callers
  // keep working; real callers should always send it.
  amountOut: z
    .string()
    .regex(/^\d+$/, "amountOut must be a base-10 integer string")
    .optional(),
  // `keccak256(universalRouterCalldata)`. The signed attestation binds to
  // this hash; the on-chain router rejects calldata that doesn't match.
  calldataHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "calldataHash must be 0x + 64 hex chars")
    .optional()
    .transform((v) => (v ? (v as `0x${string}`) : undefined)),
});

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) =>
  c.text(
    `trust-swap-oracle ${VERSION} — POST /attest with { swapperEns, recipientEns, swapper, recipient, tokenIn, tokenOut, amountIn }.`,
  ),
);

app.get("/healthz", (c) =>
  c.json({ status: "ok", version: VERSION, time: new Date().toISOString() }),
);

app.post("/attest", async (c) => {
  const env = c.env;
  if (!env.ORACLE_PRIVATE_KEY) {
    return c.json<AttestErrorResponse>(
      { error: "oracle misconfigured: ORACLE_PRIVATE_KEY missing" },
      500,
    );
  }

  // 1. Parse + validate the request body.
  let body: z.infer<typeof AttestRequestSchema>;
  try {
    const raw = await c.req.json();
    body = AttestRequestSchema.parse(raw);
  } catch (err) {
    return c.json<AttestErrorResponse>(
      {
        error:
          err instanceof z.ZodError
            ? `invalid request: ${err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
            : "invalid JSON body",
      },
      400,
    );
  }

  // 2. Re-resolve both sides via TRL. Verify the claimed addresses match
  //    what we resolve from each ENS name — defends against a swapper
  //    submitting their address paired with a different ENS's tier.
  const ensRpcUrl = env.ETH_RPC_URL;
  let swapperProfile: TrustProfile;
  let recipientProfile: TrustProfile;
  try {
    [swapperProfile, recipientProfile] = await Promise.all([
      resolve(body.swapperEns, { ensRpcUrl }),
      resolve(body.recipientEns, { ensRpcUrl }),
    ]);
  } catch (err) {
    return c.json<AttestErrorResponse>(
      {
        error: `TRL resolve failed: ${err instanceof Error ? err.message : "unknown"}`,
      },
      502,
    );
  }

  if (
    !swapperProfile.address ||
    swapperProfile.address.toLowerCase() !== body.swapper.toLowerCase()
  ) {
    return c.json<AttestErrorResponse>(
      {
        error: `swapper address mismatch: ENS resolves to ${swapperProfile.address ?? "<none>"}, request claimed ${body.swapper}`,
      },
      400,
    );
  }
  if (
    !recipientProfile.address ||
    recipientProfile.address.toLowerCase() !== body.recipient.toLowerCase()
  ) {
    return c.json<AttestErrorResponse>(
      {
        error: `recipient address mismatch: ENS resolves to ${recipientProfile.address ?? "<none>"}, request claimed ${body.recipient}`,
      },
      400,
    );
  }

  // 3. Subname tier inheritance.
  //
  // Subnames (e.g. `kernel.emilemarcelagustin.eth`) are operational handles
  // owned by the parent. ENS gates subname creation on parent ownership, so
  // if a subname exists, the parent owner authorized it implicitly. Treat
  // tier=none subnames as inheriting their parent's tier when the parent
  // has one.
  //
  // We only walk one level — a subname inherits from its IMMEDIATE parent,
  // not its grandparent. Keeps the contract simple and avoids ambiguity
  // when intermediate labels (`alice.team.example.eth`) have differing tiers.
  const swapperEffectiveTier = await inheritTierFromParent(
    swapperProfile.trustScore,
    body.swapperEns,
    ensRpcUrl,
  );
  const recipientEffectiveTier = await inheritTierFromParent(
    recipientProfile.trustScore,
    body.recipientEns,
    ensRpcUrl,
  );

  // 4. Floor — tier=none on either side fails fast with onboarding hint.
  if (swapperEffectiveTier === "none") {
    return c.json<AttestErrorResponse>(
      {
        error: `swapper ${body.swapperEns} is tier none — not eligible for gated settlement`,
        hint: "register on AgentBook (tier none → registered) and re-attempt.",
      },
      403,
    );
  }
  if (recipientEffectiveTier === "none") {
    return c.json<AttestErrorResponse>(
      {
        error: `recipient ${body.recipientEns} is tier none — not eligible for gated settlement`,
        hint: "ask the recipient to register on AgentBook before sending value.",
      },
      403,
    );
  }

  // 5. Bidirectional RiskPolicy check.
  let swapperRiskPolicy: RiskPolicy | null;
  let recipientRiskPolicy: RiskPolicy | null;
  try {
    [swapperRiskPolicy, recipientRiskPolicy] = await Promise.all([
      resolveRiskPolicy(body.swapperEns, { ensRpcUrl }),
      resolveRiskPolicy(body.recipientEns, { ensRpcUrl }),
    ]);
  } catch (err) {
    return c.json<AttestErrorResponse>(
      {
        error: `RiskPolicy fetch failed: ${err instanceof Error ? err.message : "unknown"}`,
      },
      502,
    );
  }

  const amountIn = BigInt(body.amountIn);

  const fromSwapperToRecipient = checkRiskPolicy({
    sourceLabel: "recipient",
    policy: recipientRiskPolicy,
    counterpartyTier: swapperEffectiveTier,
    counterpartyManifestSigValid:
      swapperProfile.manifest.found &&
      swapperProfile.manifest.signatureValid,
    tokenInbound: body.tokenIn,
    amountInbound: amountIn,
  });
  if (fromSwapperToRecipient.error) {
    return c.json<AttestErrorResponse>(fromSwapperToRecipient.error, 403);
  }

  // Codex P2 #3: enforce the swapper's `maxAcceptedSize` against the
  // amount they will RECEIVE (tokenOut) — not 0n. If the caller
  // didn't supply `amountOut` (legacy mock path), this falls back to 0n
  // and the size check is silently skipped, same as before.
  const swapperInboundAmount = body.amountOut ? BigInt(body.amountOut) : 0n;
  const fromRecipientToSwapper = checkRiskPolicy({
    sourceLabel: "swapper",
    policy: swapperRiskPolicy,
    counterpartyTier: recipientEffectiveTier,
    counterpartyManifestSigValid:
      recipientProfile.manifest.found &&
      recipientProfile.manifest.signatureValid,
    tokenInbound: body.tokenOut,
    amountInbound: swapperInboundAmount,
  });
  if (fromRecipientToSwapper.error) {
    return c.json<AttestErrorResponse>(fromRecipientToSwapper.error, 403);
  }

  // 5. Build the canonical attestation. Nonce sourced from a CSPRNG;
  //    expiresAt is `now + TTL`.
  const expiresAt = Math.floor(Date.now() / 1000) + ATTESTATION_TTL_SECONDS;
  const nonce = randomNonce();
  const attestation: Attestation = {
    swapper: body.swapper,
    recipient: body.recipient,
    swapperTier: swapperEffectiveTier,
    recipientTier: recipientEffectiveTier,
    expiresAt,
    nonce,
    // Bind to the exact swap calldata. Falls back to a zero hash when the
    // caller didn't supply one (legacy mock callers / pre-quote diagnostic
    // mode). The on-chain router will reject the zero-hash path because
    // `keccak256(real_calldata) != 0x000…`, which is the correct safety
    // — only intentional binding produces a usable attestation.
    calldataHash:
      body.calldataHash ?? (`0x${"00".repeat(32)}` as Hex),
  };

  // 6. Sign. The contract verifies via
  //    `ECDSA.recover(toEthSignedMessageHash(keccak256(abi.encode(att))), sig)`,
  //    so we encode the same tuple, hash it, then ask viem to sign with
  //    the EIP-191 prefix (`{ raw: digest }` triggers raw-bytes mode).
  const digest = encodeAttestationDigest(attestation);
  // Defensively normalize: CF Workers occasionally surfaces secrets with
  // trailing whitespace, and `wrangler secret put` may or may not strip it
  // depending on how stdin was piped. We also tolerate a missing `0x`
  // prefix so a hex-without-prefix paste in the dashboard still works.
  // Defensively normalize: tolerate trailing whitespace + missing 0x
  // prefix on the secret. Length should be exactly 66 (0x + 64 hex chars);
  // surface a clear error if not so deploy-time misconfiguration doesn't
  // hide behind viem's generic "got string" message.
  const rawKey = env.ORACLE_PRIVATE_KEY.trim();
  const normalizedKey = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as Hex;
  if (normalizedKey.length !== 66) {
    return c.json<AttestErrorResponse>(
      {
        error: `oracle misconfigured: ORACLE_PRIVATE_KEY length=${normalizedKey.length}, expected 66 (0x + 64 hex chars). Re-set with \`pnpm --silent oracle:export-key | wrangler secret put ORACLE_PRIVATE_KEY\`.`,
      },
      500,
    );
  }
  const account = privateKeyToAccount(normalizedKey);
  if (
    env.ORACLE_PUBKEY_ADDRESS &&
    account.address.toLowerCase() !== env.ORACLE_PUBKEY_ADDRESS.toLowerCase()
  ) {
    return c.json<AttestErrorResponse>(
      {
        error: `oracle misconfigured: signer ${account.address} != configured ORACLE_PUBKEY_ADDRESS ${env.ORACLE_PUBKEY_ADDRESS}`,
      },
      500,
    );
  }
  const signature = await account.signMessage({ message: { raw: digest } });

  // 7. Audit log — addresses + ENS names + tiers, no secrets. Includes raw
  //    (pre-inheritance) and effective tiers so subname-delegation events
  //    are auditable.
  console.log(
    JSON.stringify({
      event: "attest.signed",
      swapperEns: body.swapperEns,
      recipientEns: body.recipientEns,
      swapperTierRaw: swapperProfile.trustScore,
      swapperTierEffective: attestation.swapperTier,
      recipientTierRaw: recipientProfile.trustScore,
      recipientTierEffective: attestation.recipientTier,
      expiresAt,
      nonce,
      digest,
    }),
  );

  return c.json<AttestResponse>({ attestation, signature });
});

export default app;

// ---------------------------------------------------------------------------
// RiskPolicy bidirectional check
// ---------------------------------------------------------------------------

interface RiskPolicyCheckInput {
  sourceLabel: "swapper" | "recipient";
  policy: RiskPolicy | null;
  counterpartyTier: TrustTier;
  counterpartyManifestSigValid: boolean;
  tokenInbound: Address;
  amountInbound: bigint;
}

function checkRiskPolicy(
  input: RiskPolicyCheckInput,
): { error: AttestErrorResponse | null } {
  if (!input.policy) return { error: null }; // no policy published → router floor only

  const p = input.policy;

  if (
    TIER_RANK[input.counterpartyTier] < TIER_RANK[p.minCounterpartyTier]
  ) {
    return {
      error: {
        error: `${input.sourceLabel} RiskPolicy requires minCounterpartyTier=${p.minCounterpartyTier}, counterparty is ${input.counterpartyTier}`,
        hint: `the ${input.sourceLabel === "recipient" ? "recipient" : "swapper"} won't accept counterparties below ${p.minCounterpartyTier}`,
      },
    };
  }

  if (input.amountInbound > 0n && input.amountInbound > p.maxAcceptedSize) {
    return {
      error: {
        error: `${input.sourceLabel} RiskPolicy.maxAcceptedSize=${p.maxAcceptedSize} exceeded by amount ${input.amountInbound}`,
        hint: `resubmit with amount <= ${p.maxAcceptedSize}`,
      },
    };
  }

  if (
    p.acceptedTokens.length > 0 &&
    !p.acceptedTokens.some(
      (t) => t.toLowerCase() === input.tokenInbound.toLowerCase(),
    )
  ) {
    return {
      error: {
        error: `${input.sourceLabel} RiskPolicy does not accept token ${input.tokenInbound}`,
        hint: `${input.sourceLabel} accepts: ${p.acceptedTokens.join(", ")}`,
      },
    };
  }

  if (p.requiredManifestSig && !input.counterpartyManifestSigValid) {
    return {
      error: {
        error: `${input.sourceLabel} RiskPolicy requires verified manifest signature; counterparty's signature is invalid or absent`,
        hint: `ask the counterparty to re-sign their AIP manifest with the current ENS owner key`,
      },
    };
  }

  return { error: null };
}

// ---------------------------------------------------------------------------
// Attestation encoding — must match Solidity `abi.encode(att)`
// ---------------------------------------------------------------------------

function encodeAttestationDigest(att: Attestation): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint8" },
        { type: "uint8" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [
        att.swapper,
        att.recipient,
        TIER_INDEX[att.swapperTier],
        TIER_INDEX[att.recipientTier],
        BigInt(att.expiresAt),
        BigInt(att.nonce),
        att.calldataHash,
      ],
    ),
  );
}

// ---------------------------------------------------------------------------
// Subname tier inheritance
//
// If a subname (3+ labels) resolves to tier=none, walk up one level and use
// its parent's tier. ENS gates subname creation on parent ownership, so an
// existing subname is implicit delegation from the parent. Only one level
// of walk-up to keep semantics simple — `kernel.alice.eth` inherits from
// `alice.eth` but `kernel.team.alice.eth` would inherit from `team.alice.eth`,
// not from `alice.eth`.
// ---------------------------------------------------------------------------

async function inheritTierFromParent(
  rawTier: TrustTier,
  ensName: string,
  ensRpcUrl: string | undefined,
): Promise<TrustTier> {
  if (rawTier !== "none") return rawTier;
  const labels = ensName.split(".");
  if (labels.length < 3) return rawTier; // not a subname; nothing to inherit from
  const parent = ensName.slice(ensName.indexOf(".") + 1);
  try {
    const parentProfile = await resolve(parent, { ensRpcUrl });
    if (parentProfile.trustScore === "none") return rawTier;
    return parentProfile.trustScore;
  } catch {
    return rawTier;
  }
}

function randomNonce(): number {
  // CF Workers exposes crypto.getRandomValues globally. Bounded to a uint32
  // for compactness; the contract stores in a uint256 mapping so collision
  // probability across (swapper, nonce) is dominated by birthday-paradox on
  // a 2^32 space — fine for hackathon scale, tighten to 2^64 for production.
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  return (
    (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]
  ) >>> 0;
}
