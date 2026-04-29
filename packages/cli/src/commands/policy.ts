import colors from "yoctocolors";
import {
  parseRiskPolicy,
  publishRiskPolicy,
  resolveRiskPolicyWithProvenance,
  type RiskPolicy,
  type RiskPolicyProvenance,
} from "@trust-swap/core";
import { resolveToken } from "../utils/tokens.js";

// ---------------------------------------------------------------------------
// `tru policy publish` — write the agent-risk-policy ENS text record.
// ---------------------------------------------------------------------------

export interface PublishPolicyOptions {
  /** Caller's ENS name — the record gets written to its resolver. */
  ensName?: string;
  minTier: "registered" | "discoverable" | "verified" | "full";
  /** Maximum inbound size denominated in USD (e.g. 5000 for $5k). */
  maxSize: number;
  /** Comma-separated symbols (USDC, WETH) or 0x addresses. */
  tokens: string;
  requireManifestSig?: boolean;
  /** ISO-8601 timestamp; the record is treated as absent past this. */
  validUntil?: string;
  /** "inline" | "ipfs" | "auto". Default: auto. */
  storage?: "inline" | "ipfs" | "auto";
}

export async function runPolicyPublish(
  options: PublishPolicyOptions,
): Promise<{ recordValue: string; txHash: `0x${string}` }> {
  const ensName = options.ensName ?? process.env.ENS_PRIMARY_NAME;
  if (!ensName) {
    throw new Error(
      "ensName not provided — pass --ens-name or set ENS_PRIMARY_NAME",
    );
  }
  const controllerPrivateKey = process.env.ENS_PRIVATE_KEY as
    | `0x${string}`
    | undefined;
  if (!controllerPrivateKey) {
    throw new Error(
      "ENS_PRIVATE_KEY not set — required to sign the resolver setText call",
    );
  }

  // ---- Build the RiskPolicy from CLI flags ----------------------------------
  const tokenList = options.tokens
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((entry) => resolveToken(entry).address);
  if (tokenList.length === 0) {
    throw new Error("--tokens must list at least one symbol or 0x address");
  }

  // RiskPolicy.maxAcceptedSize is denominated in 6-decimal USDC base units
  // (matches the off-chain `tierBucket` table). Convert USD → base units.
  const maxAcceptedSize = BigInt(Math.round(options.maxSize * 1_000_000));

  let validUntilSeconds: number | undefined;
  if (options.validUntil) {
    const parsed = Date.parse(options.validUntil);
    if (Number.isNaN(parsed)) {
      throw new Error(`--valid-until must be ISO-8601 (got "${options.validUntil}")`);
    }
    validUntilSeconds = Math.floor(parsed / 1000);
  }

  const policy: RiskPolicy = parseRiskPolicy({
    minCounterpartyTier: options.minTier,
    maxAcceptedSize: maxAcceptedSize.toString(),
    acceptedTokens: tokenList,
    requiredManifestSig: options.requireManifestSig,
    validUntil: validUntilSeconds,
  });

  // ---- Pretty-print preview before writing ----------------------------------
  console.log();
  console.log(
    colors.bold(`  tru policy publish → ${colors.cyan(ensName)}`),
  );
  console.log(colors.dim(`  minCounterpartyTier:   ${policy.minCounterpartyTier}`));
  console.log(
    colors.dim(`  maxAcceptedSize:       ${policy.maxAcceptedSize} (= $${options.maxSize})`),
  );
  console.log(
    colors.dim(`  acceptedTokens:        ${policy.acceptedTokens.length} (${policy.acceptedTokens.map(shortAddr).join(", ")})`),
  );
  if (policy.requiredManifestSig) {
    console.log(colors.dim(`  requiredManifestSig:   true`));
  }
  if (policy.validUntil) {
    console.log(
      colors.dim(`  validUntil:            ${new Date(policy.validUntil * 1000).toISOString()}`),
    );
  }
  console.log();

  // ---- Hand off to the writer ----------------------------------------------
  const result = await publishRiskPolicy({
    ensName,
    policy,
    storage: options.storage,
    controllerPrivateKey,
    ensRpcUrl: process.env.ETH_RPC_URL,
    pinataJwt: process.env.PINATA_JWT,
  });

  console.log(
    `  ${colors.green("✓ Published")}: ${result.storage === "ipfs" ? "via IPFS" : "inline JSON"}`,
  );
  console.log(colors.dim(`  recordValue: ${result.recordValue}`));
  console.log(colors.dim(`  txHash:      ${result.txHash}`));
  console.log(colors.dim(`  https://etherscan.io/tx/${result.txHash}`));
  console.log();
  return { recordValue: result.recordValue, txHash: result.txHash };
}

// ---------------------------------------------------------------------------
// `tru policy show` — fetch + render another agent's published RiskPolicy.
// ---------------------------------------------------------------------------

export interface ShowPolicyOptions {
  ens: string;
}

export async function runPolicyShow(
  options: ShowPolicyOptions,
): Promise<{ found: boolean; source: RiskPolicyProvenance }> {
  console.log();
  console.log(colors.bold(`  tru policy show → ${colors.cyan(options.ens)}`));
  console.log();

  const { policy, source } = await resolveRiskPolicyWithProvenance(options.ens, {
    ensRpcUrl: process.env.ETH_RPC_URL,
  });

  if (!policy) {
    console.log(`  ${colors.yellow("(no policy)")}`);
    console.log(colors.dim(`  source: ${formatProvenance(source)}`));
    console.log();
    process.exitCode = 1;
    return { found: false, source };
  }

  console.log(colors.dim(`  source:               ${formatProvenance(source)}`));
  console.log(`  minCounterpartyTier:  ${tierColor(policy.minCounterpartyTier)(policy.minCounterpartyTier)}`);
  console.log(
    `  maxAcceptedSize:      ${policy.maxAcceptedSize} ${colors.dim(`(= $${(Number(policy.maxAcceptedSize) / 1_000_000).toLocaleString()})`)}`,
  );
  console.log(
    `  acceptedTokens (${policy.acceptedTokens.length}):    ${policy.acceptedTokens.map(shortAddr).join(", ")}`,
  );
  if (policy.requiredManifestSig) {
    console.log(`  requiredManifestSig:  ${colors.green("true")}`);
  }
  if (policy.validUntil) {
    console.log(
      `  validUntil:           ${new Date(policy.validUntil * 1000).toISOString()}`,
    );
  }
  console.log();
  return { found: true, source };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatProvenance(source: RiskPolicyProvenance): string {
  switch (source) {
    case "endpoint":
      return colors.green("agent-endpoint override (live)");
    case "text-record":
      return colors.blue("agent-risk-policy ENS text record (inline)");
    case "ipfs":
      return colors.blue("agent-risk-policy ENS text record → IPFS");
    case "expired":
      return colors.yellow("present but expired (treated as absent)");
    case "absent":
      return colors.dim("no policy published");
  }
}

function tierColor(
  tier: RiskPolicy["minCounterpartyTier"],
): (s: string) => string {
  switch (tier) {
    case "full":
      return colors.green;
    case "verified":
      return colors.cyan;
    case "discoverable":
      return colors.blue;
    case "registered":
      return colors.yellow;
    default:
      return colors.red;
  }
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
