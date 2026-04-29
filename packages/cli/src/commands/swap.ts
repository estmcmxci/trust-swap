import colors from "yoctocolors";
import { formatUnits, parseUnits } from "viem";
import { isAddress, type Address } from "viem";
import {
  createMockOracleClient,
  createHttpOracleClient,
  createTradingClient,
  defaultSwapPolicy,
  isUniswapXQuote,
  orchestrate,
  PLACEHOLDER_ROUTER_ADDRESS,
  type OrchestrateResult,
  type OracleClient,
  type TrustPolicy,
} from "@trust-swap/core";
import { resolveToken, type ResolvedToken } from "../utils/tokens.js";
import { buildSigner, type SignerKind } from "../utils/signer.js";

export interface SwapCommandOptions {
  recipient: string;
  tokenIn?: string;
  tokenOut?: string;
  amount: string;
  chain?: string;
  minTier?: TrustPolicy["minTier"];
  signer?: SignerKind;
  callerEns?: string;
  dryRun?: boolean;
  noLineage?: boolean;
  noSig?: boolean;
}

/**
 * `tru swap <recipient.eth>` — gate + quote + (optionally broadcast).
 *
 * Phase 1: `--dry-run` is the default and only supported mode for non-allow-self
 * paths until Phase 2's real router lands. The CLI prints a transcript of
 * every step the orchestrator took. Exit code: 0 on success, 1 on deny or
 * any halt before a successful broadcast.
 */
export async function runSwap(
  options: SwapCommandOptions,
): Promise<OrchestrateResult> {
  const chain = options.chain ?? "base";
  if (chain !== "base") {
    throw new Error(`only --chain base is supported in Phase 1 (got "${chain}")`);
  }
  const dryRun = options.dryRun ?? true;

  const tokenIn = resolveToken(options.tokenIn ?? "USDC");
  const tokenOut = resolveToken(options.tokenOut ?? "WETH");

  let amountRaw: bigint;
  try {
    amountRaw = parseUnits(options.amount, tokenIn.decimals);
  } catch {
    throw new Error(`invalid --amount "${options.amount}"`);
  }
  if (amountRaw === 0n) {
    throw new Error(`--amount must be > 0`);
  }

  // ---- Banner --------------------------------------------------------------
  console.log();
  console.log(
    colors.bold(`  tru swap → ${colors.cyan(options.recipient)}`),
  );
  console.log(
    colors.dim(
      `  ${formatTokenAmount(amountRaw, tokenIn)} ${labelFor(tokenIn)} → ${labelFor(tokenOut)} on ${chain}`,
    ),
  );
  if (dryRun) {
    console.log(colors.dim(`  ${colors.yellow("DRY RUN")} — no broadcast`));
  }
  console.log();

  // ---- Build dependencies --------------------------------------------------
  const apiKey = process.env.UNISWAP_API_KEY;
  if (!apiKey) {
    throw new Error("UNISWAP_API_KEY not set — required to fetch /quote");
  }
  const tradingClient = createTradingClient({ apiKey });

  const oracleUrl = process.env.ORACLE_URL;
  const oracleClient: OracleClient = oracleUrl
    ? createHttpOracleClient({ url: oracleUrl })
    : createMockOracleClient();
  if (!oracleUrl) {
    console.log(
      colors.dim(`  oracle: ${colors.yellow("mocked")} (set ORACLE_URL to use the deployed Worker)`),
    );
  } else {
    console.log(colors.dim(`  oracle: ${oracleUrl}`));
  }

  const { signer, kind: signerKind, ephemeral } = await buildSigner({
    kind: options.signer,
    allowEphemeral: dryRun,
  });
  console.log(
    colors.dim(
      `  signer: ${signerKind}${ephemeral ? colors.yellow(" (ephemeral)") : ""} — ${signer.address}`,
    ),
  );
  console.log();

  // ---- Run orchestrate -----------------------------------------------------
  const policy: TrustPolicy = {
    ...defaultSwapPolicy,
    minTier: options.minTier ?? defaultSwapPolicy.minTier,
    requireLineage: options.noLineage
      ? false
      : defaultSwapPolicy.requireLineage,
    requireSig: options.noSig ? false : defaultSwapPolicy.requireSig,
  };

  // Router address — required for non-dry-run (orchestrate refuses to
  // broadcast against PLACEHOLDER). Phase 2 deploy lives at TRUST_SWAP_
  // ROUTER_ADDRESS in env; pass it through whenever set.
  const envRouter = process.env.TRUST_SWAP_ROUTER_ADDRESS;
  let routerAddress: Address | undefined;
  if (envRouter && envRouter !== "" && envRouter !== PLACEHOLDER_ROUTER_ADDRESS) {
    if (!isAddress(envRouter)) {
      throw new Error(`TRUST_SWAP_ROUTER_ADDRESS is not a valid 0x address: ${envRouter}`);
    }
    routerAddress = envRouter as Address;
    console.log(colors.dim(`  router: ${routerAddress}`));
  } else if (!dryRun) {
    throw new Error(
      "TRUST_SWAP_ROUTER_ADDRESS not set — required for non-dry-run. Set it in .env or pass --dry-run.",
    );
  }
  console.log();

  const result = await orchestrate({
    recipientEns: options.recipient,
    tokenIn: tokenIn.address,
    tokenOut: tokenOut.address,
    amount: amountRaw,
    signer,
    callerEns: options.callerEns,
    tradingClient,
    oracleClient,
    policy,
    routerAddress,
    dryRun,
  });

  // ---- Pretty-print transcript --------------------------------------------
  printTranscript(result, { tokenIn, tokenOut, dryRun });

  if (result.haltedAt) {
    process.exitCode = 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Transcript printing
// ---------------------------------------------------------------------------

interface PrintContext {
  tokenIn: ResolvedToken;
  tokenOut: ResolvedToken;
  dryRun: boolean;
}

function printTranscript(r: OrchestrateResult, ctx: PrintContext): void {
  const profile = r.recipientProfile;

  // Trust card
  console.log(colors.bold(`  Recipient: ${colors.cyan(profile.ensName)}`));
  console.log(colors.dim(`  Address: ${profile.address ?? "unresolved"}`));
  console.log();
  printLayer("Personhood", profile.personhood.verified);
  printLayer("Identity", profile.identity.verified);
  printLayer("Context", profile.context.found);
  printLayer(
    "Manifest",
    profile.manifest.found &&
      profile.manifest.signatureValid &&
      profile.manifest.lineageIntact,
  );
  printLayer(
    "Skill",
    profile.skill.found && profile.skill.domainVerified,
  );
  console.log();
  console.log(
    `  Trust Tier: ${tierColor(profile.trustScore)(profile.trustScore)} ${colors.dim(
      `(required: ${r.decision.policy.minTier})`,
    )}`,
  );
  console.log();

  // Gate decision
  if (r.decision.allow) {
    console.log(`  ${colors.green("✓ Gate")}: ${colors.dim(r.decision.reason)}`);
  } else {
    console.log(`  ${colors.red("✗ Gate DENIED")}: ${colors.dim(r.decision.reason)}`);
  }

  // RiskPolicy
  if (r.recipientRiskPolicy) {
    const rp = r.recipientRiskPolicy;
    console.log();
    console.log(colors.bold("  RiskPolicy:"));
    console.log(colors.dim(`    minCounterpartyTier: ${rp.minCounterpartyTier}`));
    console.log(colors.dim(`    maxAcceptedSize: ${rp.maxAcceptedSize}`));
    console.log(colors.dim(`    acceptedTokens: ${rp.acceptedTokens.length} token(s)`));
  }

  // Halt with hint
  if (r.haltedAt) {
    console.log();
    console.log(`  ${colors.red("✗ Halted at")}: ${r.haltedAt}`);
    if (r.onboardingHint) {
      console.log(colors.dim(`    ${r.onboardingHint}`));
    }
    console.log();
    return;
  }

  // Attestation
  if (r.attestation) {
    console.log();
    console.log(colors.bold("  Attestation:"));
    console.log(colors.dim(`    swapperTier: ${r.attestation.swapperTier}`));
    console.log(colors.dim(`    recipientTier: ${r.attestation.recipientTier}`));
    console.log(
      colors.dim(
        `    expiresAt: ${new Date(r.attestation.expiresAt * 1000).toISOString()}`,
      ),
    );
    console.log(colors.dim(`    nonce: ${r.attestation.nonce}`));
  }

  // Quote
  if (r.quote) {
    console.log();
    console.log(colors.bold(`  Quote (${r.quote.routing}):`));
    if (isUniswapXQuote(r.quote)) {
      const out = r.quote.quote.orderInfo.outputs[0];
      if (out) {
        console.log(
          colors.dim(
            `    ${formatTokenAmount(BigInt(r.quote.quote.orderInfo.input.startAmount), ctx.tokenIn)} ${labelFor(ctx.tokenIn)} → ${formatTokenAmount(BigInt(out.startAmount), ctx.tokenOut)} ${labelFor(ctx.tokenOut)}`,
          ),
        );
      }
    } else {
      const c = r.quote;
      console.log(
        colors.dim(
          `    ${formatTokenAmount(BigInt(c.quote.input.amount), ctx.tokenIn)} ${labelFor(ctx.tokenIn)} → ${formatTokenAmount(BigInt(c.quote.output.amount), ctx.tokenOut)} ${labelFor(ctx.tokenOut)}`,
        ),
      );
      console.log(colors.dim(`    gas: $${c.quote.gasFeeUSD}`));
      console.log(colors.dim(`    slippage: ${c.quote.slippage}%`));
    }
  }

  // Router calldata
  if (r.routerCalldata) {
    console.log();
    console.log(
      colors.dim(
        `  routerCalldata: ${r.routerCalldata.slice(0, 10)}…${r.routerCalldata.slice(-8)} (${r.routerCalldata.length} chars)`,
      ),
    );
  }

  // Final status
  console.log();
  if (ctx.dryRun) {
    console.log(
      `  ${colors.green("✓ DRY RUN OK")} ${colors.dim(`(synthetic txHash ${r.txHash})`)}`,
    );
  } else if (r.txHash) {
    console.log(`  ${colors.green("✓ Broadcast")}: ${r.txHash}`);
    console.log(colors.dim(`  https://basescan.org/tx/${r.txHash}`));
  }
  console.log();
}

function printLayer(name: string, ok: boolean): void {
  const mark = ok ? colors.green("✓") : colors.red("✗");
  console.log(`  ${mark} ${ok ? colors.bold(name) : colors.dim(name)}`);
}

function tierColor(tier: string): (s: string) => string {
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

function labelFor(t: ResolvedToken): string {
  return t.symbol ?? `${t.address.slice(0, 6)}…${t.address.slice(-4)}`;
}

function formatTokenAmount(raw: bigint, t: ResolvedToken): string {
  const formatted = formatUnits(raw, t.decimals);
  // Trim insignificant trailing zeros for readability while keeping at least
  // one decimal digit.
  if (!formatted.includes(".")) return formatted;
  return formatted.replace(/0+$/, "").replace(/\.$/, ".0");
}
