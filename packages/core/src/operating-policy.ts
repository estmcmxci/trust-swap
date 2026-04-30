import { z } from "zod";
import { isAddress, type Address } from "viem";
import { readFile } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { dirname, basename, resolve as resolvePath } from "node:path";

// ---------------------------------------------------------------------------
// Operating Policy
//
// The file format consumed by `tru agent run` (TRU-38) and edited by the
// OpenClaw skill (TRU-82). It describes:
//
//   - **agent** — which on-chain identity is signing (ENS name, kernel
//     address, session-key path)
//   - **schedule** — global tick cadence + optional start/end window
//   - **intents** — what the daemon should *want* to do, each with its
//     own enable flag + optional cron override
//   - **constraints** — hard safety bounds enforced before each intent
//
// The schema is the contract between the daemon and the natural-language
// editor: the LLM cannot write a malformed policy because Zod rejects it
// before the daemon ever reads from disk. Schema invariants live in this
// file alone — adding a new constraint means updating the schema, not
// patching the agent loop.
// ---------------------------------------------------------------------------

const TRUST_TIERS = ["registered", "discoverable", "verified", "full"] as const;

/** 0x-prefixed 20-byte address. */
const AddressSchema = z
  .string()
  .refine((v) => isAddress(v), "must be a 0x-prefixed 20-byte address")
  .transform((v) => v as Address);

/**
 * A token reference: either a 0x address or a symbol the agent loop knows
 * how to resolve in chain context (e.g. "USDC" → Base USDC). We keep both
 * forms valid here so policies stay portable across chains; resolution is
 * the daemon's job.
 */
const TokenRefSchema = z.union([
  AddressSchema,
  z
    .string()
    .min(1)
    .max(16)
    .refine(
      (s) => /^[A-Za-z][A-Za-z0-9]*$/.test(s),
      "token symbol must be alphanumeric, leading letter, ≤16 chars",
    ),
]);

/**
 * A recipient: ENS name or 0x address. We don't normalize ENS here — the
 * daemon will re-resolve through TRL anyway, and string-level changes
 * round-trip cleanly through atomic writes.
 */
const RecipientSchema = z.union([
  AddressSchema,
  z
    .string()
    .min(1)
    .refine(
      (s) => s.includes(".") && !s.startsWith(".") && !s.endsWith("."),
      "recipient must be a 0x address or an ENS name",
    ),
]);

/** Decimal-amount string. Pre-parsed for shape; daemon does unit math. */
const AmountStringSchema = z
  .string()
  .min(1)
  .refine(
    (s) => /^\d+(\.\d+)?$/.test(s),
    "amount must be a non-negative decimal string (e.g. '10' or '10.5')",
  );

const IsoDateSchema = z
  .string()
  .refine(
    (s) => !Number.isNaN(Date.parse(s)),
    "must be a valid ISO-8601 timestamp",
  );

// ---------------------------------------------------------------------------

const AgentSchema = z.object({
  ensName: z.string().min(1, "agent.ensName required"),
  kernelAddress: AddressSchema,
  sessionKeyPath: z.string().min(1, "agent.sessionKeyPath required"),
});

const ScheduleSchema = z
  .object({
    intervalSec: z
      .number()
      .int("schedule.intervalSec must be an integer")
      .positive("schedule.intervalSec must be > 0"),
    startAt: IsoDateSchema.optional(),
    endAt: IsoDateSchema.optional(),
  })
  .refine(
    (s) =>
      s.startAt === undefined ||
      s.endAt === undefined ||
      Date.parse(s.endAt) > Date.parse(s.startAt),
    {
      message: "schedule.endAt must be after schedule.startAt",
      path: ["endAt"],
    },
  );

const IntentSchema = z.object({
  id: z.string().min(1, "intent.id required"),
  kind: z.literal("swap"),
  tokenIn: TokenRefSchema,
  tokenOut: TokenRefSchema,
  amount: AmountStringSchema,
  recipient: RecipientSchema,
  /** Optional per-intent cadence override. Validated as opaque string. */
  cron: z.string().min(1).optional(),
  enabled: z.boolean(),
});

const ConstraintsSchema = z.object({
  maxDailySpendUsd: z
    .number()
    .nonnegative("constraints.maxDailySpendUsd must be ≥ 0"),
  minSecondsBetweenSwaps: z
    .number()
    .int("constraints.minSecondsBetweenSwaps must be an integer")
    .nonnegative("constraints.minSecondsBetweenSwaps must be ≥ 0"),
  haltOnConsecutiveFailures: z
    .number()
    .int("constraints.haltOnConsecutiveFailures must be an integer")
    .positive("constraints.haltOnConsecutiveFailures must be > 0"),
});

/**
 * Listen-mode block (Phase 6, TRU-42). Optional — Phase 5a daemons run
 * schedule-only with no peer awareness. Schema lives here so the daemon
 * doesn't need a v2 migration when A2A lands.
 */
const ListenSchema = z.object({
  peers: z.array(z.string().min(1)).min(1),
  pollIntervalSec: z
    .number()
    .int("listen.pollIntervalSec must be an integer")
    .positive("listen.pollIntervalSec must be > 0"),
  maxConcurrentIntents: z
    .number()
    .int("listen.maxConcurrentIntents must be an integer")
    .positive("listen.maxConcurrentIntents must be > 0"),
});

export const OperatingPolicySchema = z
  .object({
    version: z.literal(1),
    agent: AgentSchema,
    schedule: ScheduleSchema,
    intents: z.array(IntentSchema),
    constraints: ConstraintsSchema,
    listen: ListenSchema.optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const seen = new Set<string>();
    for (const intent of p.intents) {
      if (seen.has(intent.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["intents"],
          message: `duplicate intent id "${intent.id}"`,
        });
      }
      seen.add(intent.id);
    }
  });

export type OperatingPolicy = z.infer<typeof OperatingPolicySchema>;
export type OperatingPolicyAgent = z.infer<typeof AgentSchema>;
export type OperatingPolicyIntent = z.infer<typeof IntentSchema>;
export type OperatingPolicyConstraints = z.infer<typeof ConstraintsSchema>;

export class OperatingPolicyError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "OperatingPolicyError";
    this.cause = cause;
  }
}

/**
 * Parse + validate a candidate policy. Throws `OperatingPolicyError` with
 * the joined Zod issue list on failure so callers can surface every
 * problem at once instead of one round-trip per error.
 */
export function parseOperatingPolicy(input: unknown): OperatingPolicy {
  const result = OperatingPolicySchema.safeParse(input);
  if (!result.success) {
    throw new OperatingPolicyError(
      `OperatingPolicy validation failed: ${result.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
      result.error,
    );
  }
  return result.data;
}

/**
 * Read + parse a policy file. Surfaces filesystem errors with the path
 * for diagnosability; otherwise hands off to `parseOperatingPolicy`.
 */
export async function loadOperatingPolicyFromDisk(
  path: string,
): Promise<OperatingPolicy> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    throw new OperatingPolicyError(
      `failed to read policy file ${path}: ${err instanceof Error ? err.message : "unknown"}`,
      err,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new OperatingPolicyError(
      `policy file ${path} is not valid JSON: ${err instanceof Error ? err.message : "unknown"}`,
      err,
    );
  }
  return parseOperatingPolicy(json);
}

// ---------------------------------------------------------------------------
// File watcher
//
// OpenClaw (Phase 5b, TRU-82) writes policy edits via the canonical atomic
// pattern: write `policy.json.tmp`, fsync, then `rename()` over the live
// file. fs.watch on the file directly drops the original watch when the
// inode changes; watching the parent directory and filtering on basename
// survives renames cleanly.
//
// We debounce because some platforms emit multiple events (rename +
// change) for a single atomic write, and a hot tick-and-reload cycle
// inside the daemon shouldn't fire the callback twice.
// ---------------------------------------------------------------------------

export interface WatchOperatingPolicyOptions {
  /** Debounce window in ms. Default: 150. */
  debounceMs?: number;
  /** Override the fs.watch implementation (used by tests). */
  watchImpl?: typeof watch;
}

export interface WatchOperatingPolicyHandle {
  /** Stop watching. Idempotent. */
  close(): void;
}

/**
 * Watch a policy file for atomic-write changes. The callback fires with
 * the freshly-parsed policy on success, or an `OperatingPolicyError` on
 * filesystem / JSON / schema failure. Errors don't tear the watcher
 * down — a malformed save is recoverable by the next correct save.
 */
export function watchOperatingPolicy(
  path: string,
  onChange: (
    result: { ok: true; policy: OperatingPolicy } | { ok: false; error: OperatingPolicyError },
  ) => void,
  options: WatchOperatingPolicyOptions = {},
): WatchOperatingPolicyHandle {
  const debounceMs = options.debounceMs ?? 150;
  const watchImpl = options.watchImpl ?? watch;
  const absPath = resolvePath(path);
  const dir = dirname(absPath);
  const file = basename(absPath);

  let timer: NodeJS.Timeout | null = null;
  let closed = false;

  const fire = () => {
    if (closed) return;
    loadOperatingPolicyFromDisk(absPath)
      .then((policy) => {
        if (!closed) onChange({ ok: true, policy });
      })
      .catch((err) => {
        if (closed) return;
        const wrapped =
          err instanceof OperatingPolicyError
            ? err
            : new OperatingPolicyError(
                `unexpected watcher failure: ${err instanceof Error ? err.message : "unknown"}`,
                err,
              );
        onChange({ ok: false, error: wrapped });
      });
  };

  let watcher: FSWatcher;
  try {
    watcher = watchImpl(dir, { persistent: true }, (_event, filename) => {
      if (closed) return;
      // `filename` can be null on some platforms — fall back to firing
      // unconditionally; the load-and-parse step is the source of truth.
      if (filename !== null && filename !== file) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, debounceMs);
    });
  } catch (err) {
    throw new OperatingPolicyError(
      `failed to watch ${dir}: ${err instanceof Error ? err.message : "unknown"}`,
      err,
    );
  }

  return {
    close() {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      watcher.close();
    },
  };
}
