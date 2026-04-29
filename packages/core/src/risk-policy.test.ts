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

// ---------------------------------------------------------------------------
// TRU-76: blockTag plumbing — orchestrate/oracle reads pin to "finalized"
// to tolerate read-replica propagation lag (Alchemy lags head by 1–2
// blocks intermittently, returning "" on a freshly-set text record). When
// blockTag is set we bypass synthesis's `getTextRecord` (which queries
// latest only) and call `client.getEnsText` directly with the tag.
// ---------------------------------------------------------------------------

describe("resolveRiskPolicyWithProvenance — blockTag plumbing (TRU-76)", () => {
  beforeEach(() => {
    getTextRecordMock.mockReset();
  });

  it("default (no blockTag) routes through synthesis getTextRecord", async () => {
    // Simulates `tru policy show` keeping read-after-write UX on `latest`.
    getTextRecordMock.mockImplementation(
      async (_client: unknown, _name: string, key: string) =>
        key === "agent-risk-policy" ? VALID_POLICY_JSON : null,
    );
    const fakeClient = {
      getEnsText: vi.fn(),
    };

    const result = await resolveRiskPolicyWithProvenance("kernel.test.eth", {
      client: fakeClient as never,
      fetchImpl: makeFetchEndpoint(VALID_POLICY_JSON),
    });

    expect(result.source).toBe("text-record");
    expect(getTextRecordMock).toHaveBeenCalled();
    // No direct getEnsText call — synthesis path was used.
    expect(fakeClient.getEnsText).not.toHaveBeenCalled();
  });

  it("blockTag='finalized' bypasses synthesis and calls client.getEnsText with the tag", async () => {
    const getEnsText = vi.fn(async (params: { key: string }) =>
      params.key === "agent-risk-policy" ? VALID_POLICY_JSON : null,
    );
    const fakeClient = { getEnsText };

    const result = await resolveRiskPolicyWithProvenance("kernel.test.eth", {
      client: fakeClient as never,
      fetchImpl: makeFetchEndpoint(VALID_POLICY_JSON),
      blockTag: "finalized",
    });

    expect(result.source).toBe("text-record");
    // synthesis helper bypassed entirely; we want the raw blockTag-aware path.
    expect(getTextRecordMock).not.toHaveBeenCalled();
    // Both keys probed (endpoint + policy) with `blockTag: "finalized"`.
    expect(getEnsText).toHaveBeenCalledTimes(2);
    expect(getEnsText.mock.calls[0]?.[0]).toMatchObject({
      key: "agent-endpoint",
      blockTag: "finalized",
    });
    expect(getEnsText.mock.calls[1]?.[0]).toMatchObject({
      key: "agent-risk-policy",
      blockTag: "finalized",
    });
  });

  it("blockTag tolerates a stale 'latest' read by pinning to finalized", async () => {
    // Replica lag scenario: at `latest` the text record is empty (lagging),
    // at `finalized` the canonical chain has the JSON. Caller pinning to
    // finalized sees the JSON and the policy resolves; a `latest` caller
    // would see source: "absent".
    const getEnsText = vi.fn(
      async (params: { key: string; blockTag?: string }) => {
        if (params.key !== "agent-risk-policy") return null;
        return params.blockTag === "finalized" ? VALID_POLICY_JSON : "";
      },
    );

    const finalized = await resolveRiskPolicyWithProvenance("kernel.test.eth", {
      client: { getEnsText } as never,
      fetchImpl: makeFetchEndpoint(VALID_POLICY_JSON),
      blockTag: "finalized",
    });
    expect(finalized.source).toBe("text-record");
    expect(finalized.policy).not.toBeNull();
  });

  it("blockTag as bigint pins to a specific block number", async () => {
    const getEnsText = vi.fn(async () => VALID_POLICY_JSON);
    await resolveRiskPolicyWithProvenance("kernel.test.eth", {
      client: { getEnsText } as never,
      fetchImpl: makeFetchEndpoint(VALID_POLICY_JSON),
      blockTag: 24988175n,
    });
    expect(getEnsText.mock.calls[0]?.[0]).toMatchObject({
      blockNumber: 24988175n,
    });
  });
});
