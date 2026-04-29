#!/usr/bin/env -S node --no-deprecation
import "dotenv/config";
/**
 * tru CLI — TrustSwap command surface.
 *
 * Phase 1: `tru swap <recipient.eth>` (this file).
 * Phase 3: `tru policy publish/show`.
 * Phase 5: `tru agent run`.
 */

import { Cli, z } from "incur";
import { runSwap } from "./commands/swap.js";

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
      .describe("Skip signer.execute(...) and return a synthetic txHash. Default: true (Phase 1)"),
    noDryRun: z
      .boolean()
      .optional()
      .describe("Force broadcast — only takes effect once Phase 2's router is deployed"),
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
    const dryRun =
      options.noDryRun === true ? false : options.dryRun ?? true;
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
      clampApplied: result.clampApplied,
    };
  },
});

cli.serve();

export default cli;
