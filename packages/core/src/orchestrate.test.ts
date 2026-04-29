import { describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import type {
  ResolveOptions,
  Signer,
  TrustProfile,
  TrustTier,
} from "@synthesis/resolver";
import {
  createMockOracleClient,
  orchestrate,
  PLACEHOLDER_ROUTER_ADDRESS,
  type OracleClient,
} from "./orchestrate.js";
import type { RiskPolicy } from "./risk-policy.js";
import type {
  ClassicQuote,
  QuoteInput,
  QuoteResponse,
  SwapInput,
  SwapResponse,
  TradingClient,
} from "./trading.js";

// ---------------------------------------------------------------------------
// Fixtures
//
// These exercise the TRU-65 RiskPolicy pre-flight in orchestrate.ts. Each
// scenario short-circuits before the oracle and trading API are touched, so
// the fixtures track call counts to assert no escape.
// ---------------------------------------------------------------------------

const SWAPPER_ADDR = "0x1111111111111111111111111111111111111111" as Address;
const RECIPIENT_ADDR = "0x2222222222222222222222222222222222222222" as Address;
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as Address;
const WETH = "0x4200000000000000000000000000000000000006" as Address;
const DAI = "0x50c5725949a6f0c72e6c4a641f24049a917db0cb" as Address;

function makeProfile(
  ensName: string,
  trustScore: TrustTier,
  address: Address,
): TrustProfile {
  // TrustProfile from synthesis is a flat shape with one field per TRL layer.
  // We populate just enough for `gate()` — most checks only key off
  // `trustScore` + the `verified`/`found` booleans.
  const idx = ["none", "registered", "discoverable", "verified", "full"].indexOf(
    trustScore,
  );
  return {
    ensName,
    address,
    resolvedAt: 0,
    trustScore,
    personhood: {
      verified: idx >= 1,
      nullifierHash: null,
      network: null,
      agentBookAddress: null,
    },
    identity: {
      verified: idx >= 2,
      registryAddress: null,
      agentId: null,
      registryChain: null,
      tokenURI: null,
      owner: null,
    },
    context: { found: false, raw: null, parsed: null, skillUrl: null },
    manifest: {
      found: idx >= 3,
      latestVersion: null,
      lineageMode: null,
      manifest: null,
      signatureValid: idx >= 3,
      lineageDepth: 0,
      lineageIntact: idx >= 3,
    },
    skill: {
      found: idx >= 4,
      domainVerified: idx >= 4,
      content: null,
      url: null,
    },
  };
}

function makeSigner(): Signer {
  return {
    address: SWAPPER_ADDR,
    execute: vi.fn(async () => "0xdeadbeef" as Hex),
  };
}

function makeTradingClient(): { client: TradingClient; quoteCalls: number; swapCalls: number } {
  let quoteCalls = 0;
  let swapCalls = 0;
  const client: TradingClient = {
    async quote(_input: QuoteInput): Promise<QuoteResponse> {
      quoteCalls++;
      return {
        routing: "CLASSIC",
        permitData: null,
        quote: {
          chainId: 8453,
          input: { token: USDC, amount: "1000000" },
          output: { token: WETH, amount: "100000000000000" },
          swapper: SWAPPER_ADDR,
        } as ClassicQuote,
      } as QuoteResponse;
    },
    async swap(_input: SwapInput): Promise<SwapResponse> {
      swapCalls++;
      return {
        swap: {
          to: PLACEHOLDER_ROUTER_ADDRESS,
          from: SWAPPER_ADDR,
          data: "0x1234" as Hex,
          value: "0",
          chainId: 8453,
          gasLimit: "200000",
          maxFeePerGas: "1000000000",
          maxPriorityFeePerGas: "1000000000",
        },
      };
    },
  } as TradingClient;
  return {
    client,
    get quoteCalls() {
      return quoteCalls;
    },
    get swapCalls() {
      return swapCalls;
    },
  };
}

function makeOracleSpy(): { client: OracleClient; calls: number } {
  const inner = createMockOracleClient();
  let calls = 0;
  const client: OracleClient = {
    async attest(req) {
      calls++;
      return inner.attest(req);
    },
  };
  return {
    client,
    get calls() {
      return calls;
    },
  };
}

function makePolicy(overrides: Partial<RiskPolicy> = {}): RiskPolicy {
  return {
    minCounterpartyTier: "registered",
    maxAcceptedSize: 1_000_000_000n, // $1k @ 6 decimals
    acceptedTokens: [],
    ...overrides,
  };
}

interface ScenarioOptions {
  recipientTier?: TrustTier;
  swapperTier?: TrustTier;
  policy: RiskPolicy | null;
  amount: bigint;
  tokenIn?: Address;
  callerEns?: string | undefined;
}

async function runScenario(opts: ScenarioOptions) {
  const trading = makeTradingClient();
  const oracle = makeOracleSpy();
  const recipientProfile = makeProfile(
    "bob.eth",
    opts.recipientTier ?? "verified",
    RECIPIENT_ADDR,
  );
  const swapperProfile = makeProfile(
    "alice.eth",
    opts.swapperTier ?? "verified",
    SWAPPER_ADDR,
  );

  const resolveTrustProfile = vi.fn(async (ens: string, _o?: ResolveOptions) => {
    if (ens === "bob.eth") return recipientProfile;
    if (ens === "alice.eth") return swapperProfile;
    throw new Error(`unexpected ens ${ens}`);
  });
  const resolveRiskPolicyFn = vi.fn(async (_ens: string) => opts.policy);

  const callerEns =
    "callerEns" in opts ? opts.callerEns : "alice.eth";
  const result = await orchestrate({
    recipientEns: "bob.eth",
    callerEns,
    tokenIn: opts.tokenIn ?? USDC,
    tokenOut: WETH,
    amount: opts.amount,
    signer: makeSigner(),
    tradingClient: trading.client,
    oracleClient: oracle.client,
    resolveTrustProfile,
    resolveRiskPolicyFn,
    dryRun: true,
  });
  return { result, trading, oracle, resolveTrustProfile };
}

describe("orchestrate — TRU-65 RiskPolicy pre-flight", () => {
  it("halts on tier mismatch (swapper < recipient.minCounterpartyTier)", async () => {
    const { result, trading, oracle, resolveTrustProfile } = await runScenario({
      swapperTier: "registered",
      policy: makePolicy({ minCounterpartyTier: "verified" }),
      amount: 1_000_000n, // $1
    });

    expect(result.haltedAt).toBe("risk-policy-deny");
    expect(result.onboardingHint).toMatch(/requires tier `verified`\+/);
    expect(result.onboardingHint).toMatch(/you're at `registered`/);
    expect(result.recipientRiskPolicy).not.toBeNull();
    expect(result.swapperProfile?.trustScore).toBe("registered");
    expect(oracle.calls).toBe(0); // pre-flight short-circuited before oracle
    expect(trading.quoteCalls).toBe(0);
    // Both sides resolved exactly once (recipient + swapper).
    expect(resolveTrustProfile).toHaveBeenCalledTimes(2);
  });

  it("halts on unsupported token (tokenIn ∉ acceptedTokens)", async () => {
    const { result, trading, oracle } = await runScenario({
      policy: makePolicy({ acceptedTokens: [USDC, WETH] }),
      amount: 1_000_000n,
      tokenIn: DAI,
    });

    expect(result.haltedAt).toBe("risk-policy-deny");
    expect(result.onboardingHint).toMatch(/accepts only/);
    expect(result.onboardingHint).toMatch(/you offered/);
    // Reports the offered token's short address in the hint.
    expect(result.onboardingHint).toContain(DAI.slice(0, 6));
    expect(oracle.calls).toBe(0);
    expect(trading.quoteCalls).toBe(0);
  });

  it("halts on oversized amount (amount > maxAcceptedSize)", async () => {
    const { result, trading, oracle } = await runScenario({
      policy: makePolicy({ maxAcceptedSize: 100_000_000n }), // $100
      amount: 500_000_000n, // $500
    });

    expect(result.haltedAt).toBe("risk-policy-deny");
    expect(result.onboardingHint).toMatch(/caps inbound at 100000000/);
    expect(result.onboardingHint).toMatch(/you requested 500000000/);
    expect(result.onboardingHint).toMatch(/Resubmit with a smaller --amount/);
    expect(oracle.calls).toBe(0);
    expect(trading.quoteCalls).toBe(0);
  });

  it("passes pre-flight when policy is satisfied — oracle is consulted", async () => {
    const { result, trading, oracle } = await runScenario({
      policy: makePolicy({
        minCounterpartyTier: "registered",
        acceptedTokens: [USDC],
        maxAcceptedSize: 1_000_000_000n,
      }),
      amount: 1_000_000n, // $1
    });

    expect(result.haltedAt).toBeUndefined();
    expect(result.attestation).toBeDefined();
    expect(oracle.calls).toBe(1);
    expect(trading.quoteCalls).toBe(1);
    expect(trading.swapCalls).toBe(1);
  });

  it("surfaces recipientRiskPolicy in the result even when null", async () => {
    const { result } = await runScenario({
      policy: null,
      amount: 1_000_000n,
    });

    expect(result.recipientRiskPolicy).toBeNull();
    expect(result.haltedAt).toBeUndefined();
  });

  it("skips tier check when callerEns is omitted (oracle still authoritative)", async () => {
    const { result, oracle } = await runScenario({
      swapperTier: "registered",
      policy: makePolicy({ minCounterpartyTier: "verified" }),
      amount: 1_000_000n,
      callerEns: undefined,
    });

    // No callerEns → swapperProfile is null → tier check skipped.
    // The pipeline gets all the way to the oracle-refusal halt because
    // `callerEns` is also a hard requirement for the HTTP oracle.
    expect(result.haltedAt).toBe("oracle-refusal");
    expect(result.onboardingHint).toMatch(/callerEns/);
    expect(oracle.calls).toBe(0); // halts before HTTP call
  });
});
