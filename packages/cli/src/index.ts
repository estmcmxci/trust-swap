#!/usr/bin/env -S node --no-deprecation
// Load both `.env` (committed-shape config) and `.env.local` (gitignored
// session-key private key + other run-only secrets). `.env.local` takes
// precedence so a re-issued session key doesn't get clobbered by a stale
// .env entry.
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });
/**
 * tru CLI — TrustSwap command surface.
 *
 * Phase 1: `tru swap <recipient.eth>` (this file).
 * Phase 3: `tru policy publish/show`.
 * Phase 5: `tru agent run`.
 */

import { Cli, z } from "incur";
import { runSwap } from "./commands/swap.js";
import { runPolicyPublish, runPolicyShow } from "./commands/policy.js";

const cli = Cli.create("tru", {
  version: "0.0.0",
  description: `TrustSwap CLI — reputation-graded settlement on Uniswap.

Environment Variables:
  UNISWAP_API_KEY                Trading API key (required)
  ORACLE_URL                     TrustSwap Oracle URL (defaults to mocked)
  BASE_RPC_URL                   Base RPC for read-only viem clients
  ENS_PRIVATE_KEY                Local-signer private key (auto-generated for --dry-run)
  NAMERA_KEYSTORE_PATH           Encrypted owner keystore (Phase 2)
  NAMERA_SESSION_KEY_PATH        Serialized session-key file (Phase 2)
  NAMERA_SESSION_KEY_PRIVATE_KEY 0x-prefixed session-key signer (Phase 2)`,
  sync: {
    suggestions: [
      "tru swap emilemarcelagustin.eth --amount 1 --dry-run",
      "tru swap bob.eth --token-in WETH --token-out USDC --amount 0.5 --dry-run",
    ],
  },
});

cli.command("swap", {
  description:
    "Run the gate-then-quote pipeline against a recipient ENS. Phase 1 is dry-run only — every step prints diagnostically and the orchestrator halts at the first failure with an onboarding hint. Exit code: 0 on success, 1 on deny or any halt before broadcast.",
  args: z.object({
    recipient: z
      .string()
      .describe("Recipient ENS name (e.g., emilemarcelagustin.eth)"),
  }),
  options: z.object({
    tokenIn: z
      .string()
      .optional()
      .describe("Token-in symbol (USDC, WETH, ETH, DAI) or 0x address. Default: USDC"),
    tokenOut: z
      .string()
      .optional()
      .describe("Token-out symbol or 0x address. Default: WETH"),
    amount: z
      .string()
      .describe("Amount in human units (e.g. 1.5)"),
    chain: z
      .string()
      .optional()
      .describe("Chain (only `base` supported in Phase 1)"),
    minTier: z
      .enum(["none", "registered", "discoverable", "verified", "full"])
      .optional()
      .describe("Minimum recipient tier required (default: registered)"),
    signer: z
      .enum(["local", "namera"])
      .optional()
      .describe("Signer kind. Default: namera if NAMERA_* env set, else local"),
    callerEns: z
      .string()
      .optional()
      .describe("Caller's ENS name — required when policy.allowSelf is false"),
    dryRun: z
      .boolean()
      .optional()
      .describe("Skip signer.execute(...) and return a synthetic txHash. Default: false in Phase 2+ (router deployed); pass --dry-run to opt back into the no-broadcast path."),
    noDryRun: z
      .boolean()
      .optional()
      .describe("Legacy alias — same as omitting --dry-run."),
    noLineage: z
      .boolean()
      .optional()
      .describe("Skip the AIP manifest lineage check (default: required)"),
    noSig: z
      .boolean()
      .optional()
      .describe("Skip the manifest signature check (default: required)"),
  }),
  alias: { tokenIn: "i", tokenOut: "o", amount: "a", signer: "s", chain: "c" },
  examples: [
    {
      args: { recipient: "emilemarcelagustin.eth" },
      options: { amount: "1", dryRun: true },
      description: "Dry-run a 1 USDC → WETH swap to emilemarcelagustin.eth",
    },
    {
      args: { recipient: "bob.eth" },
      options: {
        tokenIn: "WETH",
        tokenOut: "USDC",
        amount: "0.5",
        dryRun: true,
      },
      description: "Dry-run a 0.5 WETH → USDC swap",
    },
  ],
  async run({ args, options }) {
    // Phase 2 default: broadcast. Pass --dry-run to opt out.
    const dryRun =
      options.dryRun === true ? true : options.noDryRun === true ? false : false;
    const result = await runSwap({
      recipient: args.recipient,
      tokenIn: options.tokenIn,
      tokenOut: options.tokenOut,
      amount: options.amount,
      chain: options.chain,
      minTier: options.minTier,
      signer: options.signer,
      callerEns: options.callerEns,
      dryRun,
      noLineage: options.noLineage,
      noSig: options.noSig,
    });
    return {
      decision: result.decision,
      haltedAt: result.haltedAt,
      txHash: result.txHash,
      attestation: result.attestation,
    };
  },
});

// ---------------------------------------------------------------------------
// `tru policy publish` + `tru policy show` (Phase 3 — TRU-62)
// ---------------------------------------------------------------------------

const policy = Cli.create("policy", {
  description: "Manage your published RiskPolicy on ENS.",
});

policy.command("publish", {
  description:
    "Write your `agent-risk-policy` ENS text record. Requires ENS_PRIVATE_KEY (controller key) in env.",
  options: z.object({
    ensName: z
      .string()
      .optional()
      .describe(
        "ENS name to publish on. Defaults to ENS_PRIMARY_NAME env var if set.",
      ),
    minTier: z
      .enum(["registered", "discoverable", "verified", "full"])
      .describe(
        "Minimum counterparty tier you'll accept. Cannot be 'none' — that would loosen the router floor.",
      ),
    maxSize: z
      .number()
      .positive()
      .describe(
        "Maximum inbound size in USD (e.g. 5000 for $5k). Stored as 6-decimal USDC base units.",
      ),
    tokens: z
      .string()
      .describe(
        "Comma-separated symbols (USDC, WETH, ETH) or 0x addresses you'll accept inbound.",
      ),
    requireManifestSig: z
      .boolean()
      .optional()
      .describe(
        "Require a verified AIP manifest signature on the counterparty.",
      ),
    validUntil: z
      .string()
      .optional()
      .describe(
        "ISO-8601 timestamp; the policy is treated as absent past this.",
      ),
    storage: z
      .enum(["inline", "ipfs", "auto"])
      .optional()
      .describe(
        "Where to store the serialized policy. Default: auto (inline if it fits, else IPFS).",
      ),
  }),
  alias: { ensName: "e", minTier: "t", maxSize: "s", tokens: "k" },
  examples: [
    {
      options: {
        ensName: "alice.eth",
        minTier: "verified",
        maxSize: 5000,
        tokens: "USDC,WETH",
      },
      description: "Accept verified+ counterparties up to $5k in USDC or WETH",
    },
    {
      options: {
        ensName: "alice.eth",
        minTier: "full",
        maxSize: 100,
        tokens: "USDC",
        requireManifestSig: true,
        validUntil: "2026-12-31T00:00:00Z",
      },
      description: "Strictest: full-tier only, $100 cap, USDC only, manifest-verified, expires EOY",
    },
  ],
  async run({ options }) {
    const result = await runPolicyPublish(options);
    return result;
  },
});

policy.command("show", {
  description:
    "Fetch and pretty-print another agent's published RiskPolicy + provenance.",
  args: z.object({
    ens: z.string().describe("ENS name to query"),
  }),
  examples: [
    {
      args: { ens: "emilemarcelagustin.eth" },
      description: "Show emilemarcelagustin.eth's RiskPolicy if published",
    },
  ],
  async run({ args }) {
    const result = await runPolicyShow({ ens: args.ens });
    return result;
  },
});

cli.command(policy);

cli.serve();

export default cli;
