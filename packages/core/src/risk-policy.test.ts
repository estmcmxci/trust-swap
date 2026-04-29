import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Address } from "viem";
import { resolveRiskPolicyWithProvenance } from "./risk-policy.js";

// `safeReadTextRecord` calls `getTextRecord` from `@synthesis/resolver` —
// we stub that to drive the endpoint/text-record branches independently.
const getTextRecordMock = vi.fn();
vi.mock("@synthesis/resolver", async () => {
  const actual =
    await vi.importActual<typeof import("@synthesis/resolver")>(
      "@synthesis/resolver",
    );
  return {
    ...actual,
    getTextRecord: (...args: unknown[]) => getTextRecordMock(...args),
  };
});

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as Address;

const VALID_POLICY_JSON = JSON.stringify({
  minCounterpartyTier: "registered",
  maxAcceptedSize: "100000000",
  acceptedTokens: [USDC],
  validUntil: 9999999999, // year 2286
});

const EXPIRED_POLICY_JSON = JSON.stringify({
  minCounterpartyTier: "registered",
  maxAcceptedSize: "100000000",
  acceptedTokens: [USDC],
  validUntil: 1000, // 1970
});

function makeFetchEndpoint(payload: string): typeof fetch {
  return vi.fn(async () =>
    new Response(payload, {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("resolveRiskPolicyWithProvenance — expiry fall-through", () => {
  beforeEach(() => {
    getTextRecordMock.mockReset();
  });

  it("falls through from expired endpoint to valid text record", async () => {
    // ENDPOINT_KEY -> "https://example/agent", POLICY_KEY -> valid JSON
    getTextRecordMock.mockImplementation(
      async (_client: unknown, _name: string, key: string) => {
        if (key === "agent-endpoint") return "https://example.test/agent";
        if (key === "agent-risk-policy") return VALID_POLICY_JSON;
        return null;
      },
    );

    const result = await resolveRiskPolicyWithProvenance("kernel.test.eth", {
      client: {} as never,
      fetchImpl: makeFetchEndpoint(EXPIRED_POLICY_JSON),
    });

    expect(result.source).toBe("text-record");
    expect(result.policy).not.toBeNull();
    expect(result.policy?.minCounterpartyTier).toBe("registered");
  });

  it("returns 'expired' when every source is expired", async () => {
    getTextRecordMock.mockImplementation(
      async (_client: unknown, _name: string, key: string) => {
        if (key === "agent-endpoint") return "https://example.test/agent";
        if (key === "agent-risk-policy") return EXPIRED_POLICY_JSON;
        return null;
      },
    );

    const result = await resolveRiskPolicyWithProvenance("kernel.test.eth", {
      client: {} as never,
      fetchImpl: makeFetchEndpoint(EXPIRED_POLICY_JSON),
    });

    expect(result.source).toBe("expired");
    expect(result.policy).toBeNull();
  });

  it("returns 'absent' when no records exist", async () => {
    getTextRecordMock.mockResolvedValue(null);

    const result = await resolveRiskPolicyWithProvenance("kernel.test.eth", {
      client: {} as never,
      fetchImpl: makeFetchEndpoint(VALID_POLICY_JSON),
    });

    expect(result.source).toBe("absent");
    expect(result.policy).toBeNull();
  });

  it("prefers endpoint when current (no fall-through)", async () => {
    getTextRecordMock.mockImplementation(
      async (_client: unknown, _name: string, key: string) => {
        if (key === "agent-endpoint") return "https://example.test/agent";
        if (key === "agent-risk-policy") return VALID_POLICY_JSON;
        return null;
      },
    );

    const result = await resolveRiskPolicyWithProvenance("kernel.test.eth", {
      client: {} as never,
      fetchImpl: makeFetchEndpoint(VALID_POLICY_JSON),
    });

    expect(result.source).toBe("endpoint");
  });
});
