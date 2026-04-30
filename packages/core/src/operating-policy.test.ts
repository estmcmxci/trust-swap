import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OperatingPolicyError,
  parseOperatingPolicy,
  loadOperatingPolicyFromDisk,
  watchOperatingPolicy,
  type OperatingPolicy,
} from "./operating-policy.js";

const KERNEL = "0x522D9d15D425E2b819f8963A10596eADCB19255d";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

function validPolicy(): OperatingPolicy {
  return {
    version: 1,
    agent: {
      ensName: "daemon.emilemarcelagustin.eth",
      kernelAddress: KERNEL,
      sessionKeyPath: "~/.synthesis/daemon-session-key.json",
    },
    schedule: { intervalSec: 60 },
    intents: [
      {
        id: "drip-usdc-to-kernel",
        kind: "swap",
        tokenIn: "WETH",
        tokenOut: USDC,
        amount: "0.001",
        recipient: "kernel.emilemarcelagustin.eth",
        enabled: true,
      },
    ],
    constraints: {
      maxDailySpendUsd: 25,
      minSecondsBetweenSwaps: 30,
      haltOnConsecutiveFailures: 3,
    },
  };
}

// ---------------------------------------------------------------------------
// parseOperatingPolicy
// ---------------------------------------------------------------------------

describe("parseOperatingPolicy", () => {
  it("accepts a minimal valid policy", () => {
    expect(() => parseOperatingPolicy(validPolicy())).not.toThrow();
  });

  it("accepts the optional listen block", () => {
    const p = {
      ...validPolicy(),
      listen: {
        peers: ["agent-b.estmcmxci.eth"],
        pollIntervalSec: 30,
        maxConcurrentIntents: 2,
      },
    };
    const parsed = parseOperatingPolicy(p);
    expect(parsed.listen?.peers).toEqual(["agent-b.estmcmxci.eth"]);
  });

  it("rejects a missing top-level field", () => {
    const { constraints: _, ...p } = validPolicy();
    expect(() => parseOperatingPolicy(p)).toThrow(OperatingPolicyError);
  });

  it("rejects unknown top-level fields (strict mode)", () => {
    const p = { ...validPolicy(), rogue: true };
    expect(() => parseOperatingPolicy(p)).toThrow(/rogue/);
  });

  it("rejects intervalSec ≤ 0", () => {
    const p = validPolicy();
    p.schedule.intervalSec = 0;
    expect(() => parseOperatingPolicy(p)).toThrow(/intervalSec/);
  });

  it("rejects endAt before startAt", () => {
    const p = validPolicy();
    p.schedule.startAt = "2026-05-01T00:00:00Z";
    p.schedule.endAt = "2026-04-30T00:00:00Z";
    expect(() => parseOperatingPolicy(p)).toThrow(/endAt/);
  });

  it("rejects non-ISO-8601 startAt strings (e.g. 2026/05/01, RFC-2822)", () => {
    for (const bad of [
      "2026/05/01",
      "Fri, 01 May 2026 00:00:00 GMT",
      "2026-05-01",
      "May 1, 2026",
    ]) {
      const p = validPolicy();
      p.schedule.startAt = bad;
      expect(() => parseOperatingPolicy(p), `should reject ${bad}`).toThrow();
    }
  });

  it("rejects haltOnConsecutiveFailures = 0 (must be > 0 to ever halt)", () => {
    const p = validPolicy();
    p.constraints.haltOnConsecutiveFailures = 0;
    expect(() => parseOperatingPolicy(p)).toThrow(/haltOnConsecutiveFailures/);
  });

  it("rejects negative maxDailySpendUsd", () => {
    const p = validPolicy();
    p.constraints.maxDailySpendUsd = -1;
    expect(() => parseOperatingPolicy(p)).toThrow(/maxDailySpendUsd/);
  });

  it("rejects non-decimal amount strings", () => {
    const p = validPolicy();
    const [intent] = p.intents;
    if (intent) intent.amount = "1.5e2";
    expect(() => parseOperatingPolicy(p)).toThrow(/amount/);
  });

  it("rejects malformed addresses on agent.kernelAddress", () => {
    const p = validPolicy() as unknown as { agent: { kernelAddress: string } };
    p.agent.kernelAddress = "not-an-address";
    expect(() => parseOperatingPolicy(p)).toThrow(/kernelAddress/);
  });

  it("rejects duplicate intent ids", () => {
    const p = validPolicy();
    const [first] = p.intents;
    if (first) p.intents.push({ ...first });
    expect(() => parseOperatingPolicy(p)).toThrow(/duplicate intent id/);
  });

  it("accepts symbol token refs and 0x token refs in the same policy", () => {
    const p = validPolicy();
    const [intent] = p.intents;
    if (intent) {
      intent.tokenIn = "WETH";
      intent.tokenOut = USDC;
    }
    expect(() => parseOperatingPolicy(p)).not.toThrow();
  });

  it("accepts ENS recipients and 0x recipients", () => {
    const p = validPolicy();
    const [intent] = p.intents;
    if (intent) intent.recipient = KERNEL;
    expect(() => parseOperatingPolicy(p)).not.toThrow();
  });

  it("rejects bare-word recipients (must be ENS or 0x)", () => {
    const p = validPolicy() as unknown as {
      intents: Array<{ recipient: string }>;
    };
    const [intent] = p.intents;
    if (intent) intent.recipient = "alice";
    expect(() => parseOperatingPolicy(p)).toThrow(/recipient/);
  });
});

// ---------------------------------------------------------------------------
// loadOperatingPolicyFromDisk
// ---------------------------------------------------------------------------

describe("loadOperatingPolicyFromDisk", () => {
  let tmp: string;

  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("loads + parses a valid policy file", async () => {
    tmp = mkdtempSync(join(tmpdir(), "op-policy-"));
    const path = join(tmp, "policy.json");
    writeFileSync(path, JSON.stringify(validPolicy()));
    const policy = await loadOperatingPolicyFromDisk(path);
    expect(policy.agent.ensName).toBe("daemon.emilemarcelagustin.eth");
  });

  it("surfaces a clear error for missing files", async () => {
    tmp = mkdtempSync(join(tmpdir(), "op-policy-"));
    await expect(
      loadOperatingPolicyFromDisk(join(tmp, "nope.json")),
    ).rejects.toThrow(/failed to read policy file/);
  });

  it("surfaces a JSON-parse error distinctly from a schema error", async () => {
    tmp = mkdtempSync(join(tmpdir(), "op-policy-"));
    const path = join(tmp, "policy.json");
    writeFileSync(path, "not json {");
    await expect(loadOperatingPolicyFromDisk(path)).rejects.toThrow(
      /not valid JSON/,
    );
  });

  it("surfaces schema errors verbatim", async () => {
    tmp = mkdtempSync(join(tmpdir(), "op-policy-"));
    const path = join(tmp, "policy.json");
    writeFileSync(path, JSON.stringify({ version: 1 }));
    await expect(loadOperatingPolicyFromDisk(path)).rejects.toThrow(
      /OperatingPolicy validation failed/,
    );
  });
});

// ---------------------------------------------------------------------------
// watchOperatingPolicy — atomic-write detection
// ---------------------------------------------------------------------------

describe("watchOperatingPolicy", () => {
  let tmp: string;

  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("fires on atomic rename (write tmp → rename over)", async () => {
    tmp = mkdtempSync(join(tmpdir(), "op-policy-watch-"));
    const path = join(tmp, "policy.json");
    writeFileSync(path, JSON.stringify(validPolicy()));

    const events: Array<{ ok: boolean }> = [];
    const handle = watchOperatingPolicy(
      path,
      (r) => {
        events.push({ ok: r.ok });
      },
      { debounceMs: 50 },
    );

    try {
      // Atomic-write pattern: write to .tmp then rename
      const updated = validPolicy();
      updated.constraints.maxDailySpendUsd = 100;
      const tmpFile = `${path}.tmp`;
      writeFileSync(tmpFile, JSON.stringify(updated));
      renameSync(tmpFile, path);

      await waitFor(() => events.length > 0, 1000);
      expect(events[0]?.ok).toBe(true);
    } finally {
      handle.close();
    }
  });

  it("debounces multiple events from a single write", async () => {
    tmp = mkdtempSync(join(tmpdir(), "op-policy-watch-"));
    const path = join(tmp, "policy.json");
    writeFileSync(path, JSON.stringify(validPolicy()));

    const events: Array<{ ok: boolean }> = [];
    const handle = watchOperatingPolicy(
      path,
      (r) => {
        events.push({ ok: r.ok });
      },
      { debounceMs: 100 },
    );

    try {
      // Rapid-fire writes within the debounce window
      for (let i = 0; i < 5; i++) {
        const next = validPolicy();
        next.constraints.maxDailySpendUsd = 10 + i;
        writeFileSync(path, JSON.stringify(next));
      }

      await waitFor(() => events.length > 0, 1000);
      // Wait an extra debounce to confirm no duplicate trailing fires
      await new Promise((r) => setTimeout(r, 200));
      expect(events.length).toBeLessThanOrEqual(2);
    } finally {
      handle.close();
    }
  });

  it("emits ok:false on malformed save without tearing the watcher down", async () => {
    tmp = mkdtempSync(join(tmpdir(), "op-policy-watch-"));
    const path = join(tmp, "policy.json");
    writeFileSync(path, JSON.stringify(validPolicy()));

    const events: Array<{ ok: boolean }> = [];
    const handle = watchOperatingPolicy(
      path,
      (r) => {
        events.push({ ok: r.ok });
      },
      { debounceMs: 50 },
    );

    try {
      writeFileSync(path, "not json {");
      await waitFor(() => events.some((e) => !e.ok), 1000);
      expect(events.some((e) => !e.ok)).toBe(true);

      // Recovery: write valid policy, watcher should still fire ok
      writeFileSync(path, JSON.stringify(validPolicy()));
      await waitFor(() => events.some((e) => e.ok), 1500);
      expect(events.some((e) => e.ok)).toBe(true);
    } finally {
      handle.close();
    }
  });

  it("close() is idempotent and stops further callbacks", async () => {
    tmp = mkdtempSync(join(tmpdir(), "op-policy-watch-"));
    const path = join(tmp, "policy.json");
    writeFileSync(path, JSON.stringify(validPolicy()));

    let calls = 0;
    const handle = watchOperatingPolicy(
      path,
      () => {
        calls++;
      },
      { debounceMs: 50 },
    );
    handle.close();
    handle.close(); // idempotent — must not throw

    writeFileSync(path, JSON.stringify(validPolicy()));
    await new Promise((r) => setTimeout(r, 200));
    expect(calls).toBe(0);
  });
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}
