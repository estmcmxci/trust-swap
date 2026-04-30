#!/usr/bin/env tsx
// Provision daemon.emilemarcelagustin.eth — Phase 5a (TRU-80)
//
// Single helper that batches the on-chain ceremony for a fresh agent
// identity. Produces:
//
//   ~/.synthesis/daemon-keystore.json     encrypted daemon owner key (mode 0600)
//   ~/.synthesis/daemon-kernel.pub.json   public record for the daemon kernel
//   ~/.synthesis/daemon-session-key.json  serialized session key (mode 0600)
//   infra/identities/daemon.json          public identity record (committed)
//
// One MetaMask interaction is required mid-script: the parent ENS owner
// (`0xeb0ABB…5022`, controlling `emilemarcelagustin.eth`) must create the
// subname `daemon.emilemarcelagustin.eth`, delegate it to the freshly-
// generated daemon owner address, and fund the daemon kernel with ~$5 of
// Base ETH. Once both confirm, the script resumes and finishes the rest
// (set addr, publish RiskPolicy, issue session key, write public record)
// signed by the daemon owner key alone.
//
// Resumable: each phase checks if its output already exists and skips
// unless `--force-<phase>` is passed. The end-state is `infra/identities/
// daemon.json` matching the live on-chain state.
//
// Required env:
//   BUNDLER_URL_BASE              — ERC-4337 bundler URL on Base
//   TRUST_SWAP_ROUTER_ADDRESS     — pinned by `toCallPolicy`
// Optional env:
//   BASE_RPC_URL                       — defaults to https://mainnet.base.org
//   ETH_RPC_URL                        — mainnet RPC for ENS reads/writes
//   SYNTHESIS_DAEMON_KEYSTORE_PASSWORD — bypasses prompt
//   PINATA_JWT                         — only if RiskPolicy needs IPFS storage
//   NAMERA_DAEMON_SESSION_KEY_VALID_HOURS — defaults to 168 (7 days)
//
// CLI flags:
//   --ens-name <name>      target subname (default daemon.emilemarcelagustin.eth)
//   --min-tier <tier>      RiskPolicy minCounterpartyTier (default registered)
//   --max-size <usd>       RiskPolicy maxAcceptedSize in USD (default 100)
//   --tokens <symbols>     RiskPolicy acceptedTokens, comma-sep (default USDC)
//   --resume               continue from whichever phase has incomplete output
//   --force                wipe all daemon-* state and start over
//   --dry-run              print plan + addresses, exit before any tx

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  scrypt,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  namehash,
  parseAbi,
  parseEther,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base, mainnet } from "viem/chains";
import { createAccountClient } from "@namera-ai/sdk/account";
import { createSessionKey } from "@namera-ai/sdk/session-key";
import { createKernelAccount } from "@zerodev/sdk";
import { KERNEL_V3_3, getEntryPoint } from "@zerodev/sdk/constants";
import { toMultiChainECDSAValidator } from "@zerodev/multi-chain-ecdsa-validator";
import {
  toCallPolicy,
  toGasPolicy,
  toRateLimitPolicy,
  toTimestampPolicy,
  CallPolicyVersion,
} from "@zerodev/permissions/policies";

// ---------------------------------------------------------------------------
// Config + tiny CLI parser
// ---------------------------------------------------------------------------

const TRUST_TIERS = ["registered", "discoverable", "verified", "full"] as const;
type TrustTier = (typeof TRUST_TIERS)[number];

interface Args {
  ensName: string;
  parentEnsName: string;
  subnameLabel: string;
  minTier: TrustTier;
  maxSizeUsd: number;
  tokens: string[];
  resume: boolean;
  force: boolean;
  dryRun: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string, def?: string): string | undefined => {
    const i = argv.indexOf(name);
    if (i === -1) return def;
    return argv[i + 1];
  };

  const ensName = get("--ens-name") ?? "daemon.emilemarcelagustin.eth";
  const dot = ensName.indexOf(".");
  if (dot === -1) {
    throw new Error(`--ens-name must be a subdomain (got "${ensName}")`);
  }
  const subnameLabel = ensName.slice(0, dot);
  const parentEnsName = ensName.slice(dot + 1);

  const minTier = (get("--min-tier") ?? "registered") as TrustTier;
  if (!TRUST_TIERS.includes(minTier)) {
    throw new Error(`--min-tier must be one of ${TRUST_TIERS.join(", ")} (got "${minTier}")`);
  }

  const maxSizeUsd = Number(get("--max-size") ?? "100");
  if (!Number.isFinite(maxSizeUsd) || maxSizeUsd <= 0) {
    throw new Error("--max-size must be a positive number (USD)");
  }

  const tokens = (get("--tokens") ?? "USDC")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    ensName,
    parentEnsName,
    subnameLabel,
    minTier,
    maxSizeUsd,
    tokens,
    resume: argv.includes("--resume"),
    force: argv.includes("--force"),
    dryRun: argv.includes("--dry-run"),
  };
}

// ---------------------------------------------------------------------------
// Token symbol → Base mainnet address
// ---------------------------------------------------------------------------

const BASE_TOKENS: Record<string, Address> = {
  USDC: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  WETH: "0x4200000000000000000000000000000000000006",
  DAI: "0x50c5725949a6f0c72e6c4a641f24049a917db0cb",
};

function resolveTokenAddress(symbolOrAddress: string): Address {
  if (isAddress(symbolOrAddress)) {
    return symbolOrAddress as Address;
  }
  const upper = symbolOrAddress.toUpperCase();
  const addr = BASE_TOKENS[upper];
  if (!addr) {
    throw new Error(
      `unknown token symbol "${symbolOrAddress}" — known: ${Object.keys(BASE_TOKENS).join(", ")} (or pass a 0x address)`,
    );
  }
  return addr;
}

// ---------------------------------------------------------------------------
// Keystore helpers (matched to scripts/issue-kernel-account.ts)
// ---------------------------------------------------------------------------

const scryptAsync = promisify<Buffer | string, Buffer | string, number, Buffer>(scrypt);

async function readPassword(prompt: string, envVar: string): Promise<string> {
  const fromEnv = process.env[envVar];
  if (fromEnv && fromEnv.length >= 8) return fromEnv;
  const rl = createInterface({ input, output, terminal: true });
  const pw = await rl.question(prompt);
  rl.close();
  if (pw.length < 8) {
    throw new Error("password too short — refusing to encrypt with <8 chars");
  }
  return pw;
}

async function encryptKey(privateKeyHex: string, password: string) {
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const dk = await scryptAsync(password, salt, 32);
  const cipher = createCipheriv("aes-256-ctr", dk, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(privateKeyHex.slice(2), "hex")),
    cipher.final(),
  ]);
  const mac = createHash("sha256")
    .update(Buffer.concat([dk.subarray(16, 32), ciphertext]))
    .digest();
  return {
    version: 1,
    crypto: {
      cipher: "aes-256-ctr",
      ciphertext: ciphertext.toString("hex"),
      cipherparams: { iv: iv.toString("hex") },
      kdf: "scrypt",
      kdfparams: { salt: salt.toString("hex"), n: 16384, r: 8, p: 1, dklen: 32 },
      mac: mac.toString("hex"),
    },
  };
}

interface EncryptedKeystore {
  version: number;
  crypto: {
    cipher: string;
    ciphertext: string;
    cipherparams: { iv: string };
    kdf: string;
    kdfparams: { salt: string; n: number; r: number; p: number; dklen: number };
    mac: string;
  };
}

async function decryptKeystore(
  keystore: EncryptedKeystore,
  password: string,
): Promise<Hex> {
  const { kdfparams, ciphertext, cipherparams, mac, cipher } = keystore.crypto;
  if (cipher !== "aes-256-ctr" || keystore.crypto.kdf !== "scrypt") {
    throw new Error("unsupported keystore format");
  }
  const dk = await scryptAsync(password, Buffer.from(kdfparams.salt, "hex"), kdfparams.dklen ?? 32);
  const ctBuf = Buffer.from(ciphertext, "hex");
  const expectedMac = createHash("sha256")
    .update(Buffer.concat([dk.subarray(16, 32), ctBuf]))
    .digest();
  if (!timingSafeEqual(expectedMac, Buffer.from(mac, "hex"))) {
    throw new Error("MAC mismatch — wrong password");
  }
  const decipher = createDecipheriv("aes-256-ctr", dk, Buffer.from(cipherparams.iv, "hex"));
  return `0x${Buffer.concat([decipher.update(ctBuf), decipher.final()]).toString("hex")}` as Hex;
}

// ---------------------------------------------------------------------------
// ENS contracts
// ---------------------------------------------------------------------------

const ENS_REGISTRY: Address = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const NAME_WRAPPER: Address = "0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401";

const ENS_REGISTRY_ABI = parseAbi([
  "function owner(bytes32 node) view returns (address)",
  "function resolver(bytes32 node) view returns (address)",
]);

const NAME_WRAPPER_ABI = parseAbi(["function ownerOf(uint256 id) view returns (address)"]);

const RESOLVER_ABI = parseAbi([
  "function setAddr(bytes32 node, address a)",
  "function setText(bytes32 node, string key, string value)",
  "function addr(bytes32 node) view returns (address)",
]);

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const HOME = homedir();
const KEYSTORE_PATH = join(HOME, ".synthesis", "daemon-keystore.json");
const KERNEL_PUB_PATH = join(HOME, ".synthesis", "daemon-kernel.pub.json");
const SESSION_KEY_PATH = join(HOME, ".synthesis", "daemon-session-key.json");
const IDENTITY_RECORD_PATH = join(process.cwd(), "infra", "identities", "daemon.json");

// ---------------------------------------------------------------------------
// Phase 1 — generate + encrypt daemon owner key, derive kernel address
// ---------------------------------------------------------------------------

interface Phase1Output {
  daemonOwnerAddress: Address;
  daemonKernelAddress: Address;
}

async function phase1IssueOwnerAndKernel(args: Args): Promise<Phase1Output> {
  console.log("\n— Phase 1: daemon owner key + kernel address —");

  if (existsSync(KEYSTORE_PATH) && existsSync(KERNEL_PUB_PATH) && !args.force) {
    const pub = JSON.parse(readFileSync(KERNEL_PUB_PATH, "utf-8"));
    console.log(`  reusing existing keystore at ${KEYSTORE_PATH}`);
    console.log(`  daemon owner address:    ${pub.ownerAddress}`);
    console.log(`  daemon kernel address:   ${pub.kernelAddress}`);
    return {
      daemonOwnerAddress: pub.ownerAddress as Address,
      daemonKernelAddress: pub.kernelAddress as Address,
    };
  }

  if (existsSync(KEYSTORE_PATH) && args.force) {
    throw new Error(
      `--force passed but ${KEYSTORE_PATH} exists. Refusing to clobber automatically — delete it manually first.`,
    );
  }

  if (args.dryRun) {
    console.log("  [dry-run] would generate fresh ECDSA owner key");
    console.log("  [dry-run] would encrypt to daemon-keystore.json");
    console.log("  [dry-run] would derive Namera kernel via CREATE2");
    return {
      daemonOwnerAddress: zeroAddress,
      daemonKernelAddress: zeroAddress,
    };
  }

  const bundlerUrl = process.env.BUNDLER_URL_BASE;
  if (!bundlerUrl) {
    throw new Error("BUNDLER_URL_BASE not set — fill .env first");
  }
  const rpcUrl = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

  const password = await readPassword(
    "Set encryption password for daemon owner key (>=8 chars): ",
    "SYNTHESIS_DAEMON_KEYSTORE_PASSWORD",
  );

  const ownerPrivateKey = generatePrivateKey();
  const ownerAccount = privateKeyToAccount(ownerPrivateKey);
  const publicClient = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });
  const kernelClient = await createAccountClient({
    type: "ecdsa",
    signer: ownerAccount,
    client: publicClient,
    chain: base,
    bundlerTransport: http(bundlerUrl),
    entrypointVersion: "0.7",
    kernelVersion: KERNEL_V3_3,
  });
  const daemonKernelAddress = kernelClient.account.address;

  mkdirSync(dirname(KEYSTORE_PATH), { recursive: true, mode: 0o700 });
  const encrypted = await encryptKey(ownerPrivateKey, password);
  writeFileSync(KEYSTORE_PATH, JSON.stringify(encrypted, null, 2));
  chmodSync(KEYSTORE_PATH, 0o600);
  writeFileSync(
    KERNEL_PUB_PATH,
    JSON.stringify(
      {
        ownerAddress: ownerAccount.address,
        kernelAddress: daemonKernelAddress,
        chain: "base",
        chainId: base.id,
        kernelVersion: KERNEL_V3_3,
        entrypointVersion: "0.7",
        index: 0,
        createdAt: new Date().toISOString(),
        purpose:
          "TrustSwap daemon kernel — owner key encrypted at ~/.synthesis/daemon-keystore.json",
      },
      null,
      2,
    ),
  );

  console.log(`  daemon owner address:    ${ownerAccount.address}`);
  console.log(`  daemon kernel address:   ${daemonKernelAddress}`);
  console.log(`  encrypted keystore →     ${KEYSTORE_PATH}`);
  console.log(`  public record →          ${KERNEL_PUB_PATH}`);

  return {
    daemonOwnerAddress: ownerAccount.address,
    daemonKernelAddress,
  };
}

// ---------------------------------------------------------------------------
// Phase 2 — pause for MetaMask: subname registration + kernel funding
// ---------------------------------------------------------------------------

async function phase2PromptAndVerify(args: Args, p1: Phase1Output): Promise<void> {
  console.log("\n— Phase 2: register subname + fund kernel via MetaMask —");

  if (args.dryRun) {
    console.log("  [dry-run] would prompt for two MetaMask txs:");
    console.log("    1) ENS subname creation");
    console.log("    2) Fund daemon kernel on Base");
    return;
  }

  const ensRpcUrl = process.env.ETH_RPC_URL ?? process.env.MAINNET_RPC_URL ?? undefined;
  const ensClient = createPublicClient({
    chain: mainnet,
    transport: http(ensRpcUrl),
  });
  const baseClient = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
  });

  const node = namehash(args.ensName);
  const nodeId = BigInt(node);

  // Skip prompt if subname is already registered AND kernel is funded
  const owner = await readSubnameOwner(ensClient, node, nodeId);
  const kernelBalance = await baseClient.getBalance({
    address: p1.daemonKernelAddress,
  });
  const expectedOwner = p1.daemonOwnerAddress.toLowerCase();
  const subnameOk = owner !== null && owner.toLowerCase() === expectedOwner;
  const fundingOk = kernelBalance >= parseEther("0.001");

  if (subnameOk && fundingOk) {
    console.log(`  ✓ subname ${args.ensName} already owned by ${p1.daemonOwnerAddress}`);
    console.log(`  ✓ kernel ${p1.daemonKernelAddress} already funded (${kernelBalance} wei)`);
    return;
  }

  console.log("");
  console.log("Open https://app.ens.domains and complete two transactions:");
  console.log("");
  console.log(`  1) Add subname under ${args.parentEnsName}`);
  console.log(`     • new label:   ${args.subnameLabel}`);
  console.log(`     • full name:   ${args.ensName}`);
  console.log(`     • new owner:   ${p1.daemonOwnerAddress}`);
  console.log("     • resolver:    leave default (Public Resolver)");
  console.log("");
  console.log("  2) Fund the daemon kernel on Base (~$5 of ETH)");
  console.log(`     • destination: ${p1.daemonKernelAddress}`);
  console.log("     • network:     Base mainnet");
  console.log("     • amount:      ~0.0015 ETH");
  console.log("");

  if (!subnameOk && owner !== null) {
    console.log(`  current subname owner: ${owner} (expected ${p1.daemonOwnerAddress})`);
  }
  if (!fundingOk) {
    console.log(`  current kernel balance: ${kernelBalance} wei`);
  }

  const rl = createInterface({ input, output, terminal: true });
  await rl.question("\nPress ENTER once both transactions confirm: ");
  rl.close();

  const ownerAfter = await readSubnameOwner(ensClient, node, nodeId);
  const balanceAfter = await baseClient.getBalance({
    address: p1.daemonKernelAddress,
  });
  if (ownerAfter === null || ownerAfter.toLowerCase() !== expectedOwner) {
    throw new Error(
      `subname owner check failed: registry/wrapper reports ${ownerAfter ?? "<none>"}, expected ${p1.daemonOwnerAddress}`,
    );
  }
  if (balanceAfter < parseEther("0.001")) {
    throw new Error(
      `daemon kernel balance ${balanceAfter} wei < 0.001 ETH — fund ${p1.daemonKernelAddress} on Base before continuing`,
    );
  }
  console.log(`  ✓ subname owner confirmed: ${ownerAfter}`);
  console.log(`  ✓ kernel funded: ${balanceAfter} wei on Base`);
}

async function readSubnameOwner(
  ensClient: ReturnType<typeof createPublicClient>,
  node: Hex,
  nodeId: bigint,
): Promise<Address | null> {
  // Wrapped names report owner=NameWrapper at the registry. Unwrap that
  // by asking the wrapper directly. Either path can return the daemon's
  // EOA depending on which contract the user used in the ENS app.
  let registryOwner: Address;
  try {
    registryOwner = await ensClient.readContract({
      address: ENS_REGISTRY,
      abi: ENS_REGISTRY_ABI,
      functionName: "owner",
      args: [node],
    });
  } catch {
    return null;
  }
  if (registryOwner === zeroAddress) return null;
  if (registryOwner.toLowerCase() === NAME_WRAPPER.toLowerCase()) {
    try {
      const wrapped = await ensClient.readContract({
        address: NAME_WRAPPER,
        abi: NAME_WRAPPER_ABI,
        functionName: "ownerOf",
        args: [nodeId],
      });
      return wrapped === zeroAddress ? null : wrapped;
    } catch {
      return null;
    }
  }
  return registryOwner;
}

// ---------------------------------------------------------------------------
// Phase 3 — set ENS records (addr + agent-risk-policy text)
// ---------------------------------------------------------------------------

interface Phase3Output {
  addrTx: Hex | "skipped";
  policyTx: Hex | "skipped";
  policyRecord: string;
}

async function phase3SetEnsRecords(args: Args, p1: Phase1Output): Promise<Phase3Output> {
  console.log("\n— Phase 3: set ENS records (addr + agent-risk-policy) —");

  if (args.dryRun) {
    const policyJson = serializeRiskPolicy(args);
    console.log("  [dry-run] would set addr record →", p1.daemonKernelAddress);
    console.log("  [dry-run] would set text 'agent-risk-policy' →", policyJson);
    return {
      addrTx: "skipped",
      policyTx: "skipped",
      policyRecord: policyJson,
    };
  }

  const ensRpcUrl = process.env.ETH_RPC_URL ?? process.env.MAINNET_RPC_URL ?? undefined;
  const transport = http(ensRpcUrl);
  const ensReader = createPublicClient({ chain: mainnet, transport });

  const node = namehash(args.ensName);
  const resolverAddress = await ensReader.readContract({
    address: ENS_REGISTRY,
    abi: ENS_REGISTRY_ABI,
    functionName: "resolver",
    args: [node],
  });
  if (resolverAddress === zeroAddress) {
    throw new Error(
      `${args.ensName} has no resolver set — re-create the subname with the default Public Resolver in the ENS app`,
    );
  }

  // Decrypt daemon owner key — needs to sign two mainnet txs
  const password = await readPassword(
    "Daemon keystore password: ",
    "SYNTHESIS_DAEMON_KEYSTORE_PASSWORD",
  );
  const keystore = JSON.parse(readFileSync(KEYSTORE_PATH, "utf-8"));
  let ownerPrivateKey: Hex | null = await decryptKeystore(keystore, password);
  const account = privateKeyToAccount(ownerPrivateKey);
  const walletClient = createWalletClient({
    chain: mainnet,
    account,
    transport,
  });

  // 1) addr record — set if missing or stale
  let addrTx: Hex | "skipped" = "skipped";
  const currentAddr = await ensReader.readContract({
    address: resolverAddress,
    abi: RESOLVER_ABI,
    functionName: "addr",
    args: [node],
  });
  if (currentAddr.toLowerCase() === p1.daemonKernelAddress.toLowerCase()) {
    console.log(`  ✓ addr already set to ${p1.daemonKernelAddress}`);
  } else {
    addrTx = await walletClient.writeContract({
      address: resolverAddress,
      abi: RESOLVER_ABI,
      functionName: "setAddr",
      args: [node, p1.daemonKernelAddress],
    });
    console.log(`  ✓ setAddr submitted — tx ${addrTx}`);
    await ensReader.waitForTransactionReceipt({ hash: addrTx });
    console.log(`  ✓ addr → ${p1.daemonKernelAddress} confirmed`);
  }

  // 2) agent-risk-policy text record
  const policyRecord = serializeRiskPolicy(args);
  const policyTx = await walletClient.writeContract({
    address: resolverAddress,
    abi: RESOLVER_ABI,
    functionName: "setText",
    args: [node, "agent-risk-policy", policyRecord],
  });
  console.log(`  ✓ setText (agent-risk-policy) submitted — tx ${policyTx}`);
  await ensReader.waitForTransactionReceipt({ hash: policyTx });
  console.log(`  ✓ RiskPolicy published: ${policyRecord}`);

  ownerPrivateKey = null;
  return { addrTx, policyTx, policyRecord };
}

function serializeRiskPolicy(args: Args): string {
  // Mirrors @trust-swap/core's serializeRiskPolicy. maxAcceptedSize is in
  // USDC base units (6 decimals) since the on-chain RiskPolicy comparison
  // is denominated against USDC (per the schema in core/risk-policy.ts).
  const acceptedTokens = args.tokens.map(resolveTokenAddress);
  const maxAcceptedSizeUsdcBase = BigInt(Math.round(args.maxSizeUsd * 1_000_000));
  return JSON.stringify({
    minCounterpartyTier: args.minTier,
    maxAcceptedSize: maxAcceptedSizeUsdcBase.toString(),
    acceptedTokens,
  });
}

// ---------------------------------------------------------------------------
// Phase 4 — issue session key for the daemon kernel
// ---------------------------------------------------------------------------

interface Phase4Output {
  sessionSignerAddress: Address;
  validUntil: number;
}

async function phase4IssueSessionKey(args: Args, p1: Phase1Output): Promise<Phase4Output> {
  console.log("\n— Phase 4: issue daemon session key —");

  if (existsSync(SESSION_KEY_PATH) && !args.force) {
    const existing = JSON.parse(readFileSync(SESSION_KEY_PATH, "utf-8"));
    const now = Math.floor(Date.now() / 1000);
    if (
      existing.kernelAccount?.toLowerCase() === p1.daemonKernelAddress.toLowerCase() &&
      existing.validUntil > now
    ) {
      console.log(`  reusing valid session key at ${SESSION_KEY_PATH}`);
      console.log(`  session signer:   ${existing.sessionSigner}`);
      console.log(`  validUntil:       ${new Date(existing.validUntil * 1000).toISOString()}`);
      return {
        sessionSignerAddress: existing.sessionSigner as Address,
        validUntil: existing.validUntil,
      };
    }
  }

  if (args.dryRun) {
    console.log("  [dry-run] would issue session key with toCallPolicy pinned to TrustSwapRouter");
    return {
      sessionSignerAddress: zeroAddress,
      validUntil: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
    };
  }

  const bundlerUrl = process.env.BUNDLER_URL_BASE;
  if (!bundlerUrl) throw new Error("BUNDLER_URL_BASE not set");
  const rpcUrl = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
  const routerAddress = process.env.TRUST_SWAP_ROUTER_ADDRESS as Address | undefined;
  if (!routerAddress || !isAddress(routerAddress)) {
    throw new Error("TRUST_SWAP_ROUTER_ADDRESS not set or invalid");
  }
  const validHours = Number(process.env.NAMERA_DAEMON_SESSION_KEY_VALID_HOURS ?? "168");
  if (!Number.isFinite(validHours) || validHours <= 0) {
    throw new Error("NAMERA_DAEMON_SESSION_KEY_VALID_HOURS must be a positive number");
  }

  const password = await readPassword(
    "Daemon keystore password (for session key issue): ",
    "SYNTHESIS_DAEMON_KEYSTORE_PASSWORD",
  );
  const keystore = JSON.parse(readFileSync(KEYSTORE_PATH, "utf-8"));
  let ownerPrivateKey: Hex | null = await decryptKeystore(keystore, password);
  const ownerAccount = privateKeyToAccount(ownerPrivateKey);

  const publicClient = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });
  const entryPoint = getEntryPoint("0.7");
  const sudoValidator = await toMultiChainECDSAValidator(publicClient, {
    entryPoint,
    kernelVersion: KERNEL_V3_3,
    signer: ownerAccount,
  });
  const account = await createKernelAccount(publicClient, {
    entryPoint,
    index: 0n,
    kernelVersion: KERNEL_V3_3,
    plugins: { sudo: sudoValidator },
  });

  if (account.address.toLowerCase() !== p1.daemonKernelAddress.toLowerCase()) {
    throw new Error(`derived kernel ${account.address} ≠ recorded ${p1.daemonKernelAddress}`);
  }

  const sessionPrivateKey = generatePrivateKey();
  const sessionAccount = privateKeyToAccount(sessionPrivateKey);
  const validUntil = Math.floor(Date.now() / 1000) + validHours * 3600;

  // Bounds per PHASE-5-6-PLAN.md § C step 1: 1 swap/min, $5 cap, 7-day
  // expiry. $5 ≈ 0.002 ETH at ETH ≈ $2500. Conservative ceiling: 0.005
  // ETH (matches the manual-swap session key) since the on-chain router
  // already enforces the dollar cap; this is just gas headroom.
  const ROUTER_ABI = parseAbi([
    "function gatedSwap(bytes universalRouterCalldata, (address swapper, address recipient, uint8 swapperTier, uint8 recipientTier, uint256 expiresAt, uint256 nonce, bytes32 calldataHash) attestation, bytes oracleSig) external payable",
  ]);
  const callPolicy = toCallPolicy({
    policyVersion: CallPolicyVersion.V0_0_4,
    permissions: [
      {
        target: routerAddress,
        abi: ROUTER_ABI,
        functionName: "gatedSwap",
        valueLimit: parseEther("0.005"),
      },
    ],
  });
  const gasPolicy = toGasPolicy({ allowed: parseEther("0.005") });
  const rateLimitPolicy = toRateLimitPolicy({ count: 1, interval: 60 });
  const timestampPolicy = toTimestampPolicy({ validUntil });

  const result = await createSessionKey({
    type: "ecdsa",
    accountType: "ecdsa",
    entrypointVersion: "0.7",
    kernelVersion: KERNEL_V3_3,
    clients: [publicClient],
    signer: ownerAccount,
    sessionPrivateKey,
    policies: [callPolicy, gasPolicy, rateLimitPolicy, timestampPolicy],
  });

  ownerPrivateKey = null;

  if (
    !result.serializedAccounts ||
    result.serializedAccounts.length !== 1 ||
    result.serializedAccounts[0].chainId !== base.id
  ) {
    throw new Error(
      `unexpected serializedAccounts shape: ${JSON.stringify(
        result.serializedAccounts.map((s) => ({ chainId: s.chainId })),
      )}`,
    );
  }
  const serialized = result.serializedAccounts[0].serializedAccount;

  writeFileSync(
    SESSION_KEY_PATH,
    JSON.stringify(
      {
        version: 1,
        chain: "base",
        chainId: base.id,
        kernelAccount: account.address,
        sessionSigner: sessionAccount.address,
        sessionPrivateKey,
        routerPinned: routerAddress,
        validUntil,
        validUntilISO: new Date(validUntil * 1000).toISOString(),
        serializedAccount: serialized,
        createdAt: new Date().toISOString(),
        purpose:
          "TrustSwap daemon session key — toCallPolicy pinned to TrustSwapRouter, 1 swap/min, 7-day expiry",
      },
      null,
      2,
    ),
  );
  chmodSync(SESSION_KEY_PATH, 0o600);

  console.log(`  session signer:   ${sessionAccount.address}`);
  console.log(`  router pinned:    ${routerAddress}`);
  console.log(`  validUntil:       ${new Date(validUntil * 1000).toISOString()} (${validHours}h)`);
  console.log(`  serialized →      ${SESSION_KEY_PATH}`);

  return {
    sessionSignerAddress: sessionAccount.address,
    validUntil,
  };
}

// ---------------------------------------------------------------------------
// Phase 5 — write infra/identities/daemon.json (committed public record)
// ---------------------------------------------------------------------------

function phase5WriteIdentityRecord(
  args: Args,
  p1: Phase1Output,
  p3: Phase3Output,
  p4: Phase4Output,
): void {
  console.log("\n— Phase 5: write infra/identities/daemon.json —");

  const record = {
    version: 1,
    role: "trust-swap-daemon",
    ensName: args.ensName,
    parentEnsName: args.parentEnsName,
    chain: "base",
    chainId: base.id,
    daemonOwnerAddress: p1.daemonOwnerAddress,
    daemonKernelAddress: p1.daemonKernelAddress,
    sessionSignerAddress: p4.sessionSignerAddress,
    sessionKeyValidUntil: p4.validUntil,
    sessionKeyValidUntilISO: new Date(p4.validUntil * 1000).toISOString(),
    routerPinned: process.env.TRUST_SWAP_ROUTER_ADDRESS,
    keystorePath: KEYSTORE_PATH,
    sessionKeyPath: SESSION_KEY_PATH,
    riskPolicy: {
      minCounterpartyTier: args.minTier,
      maxSizeUsd: args.maxSizeUsd,
      acceptedTokens: args.tokens,
      published: p3.policyRecord,
    },
    txs: {
      setAddr: p3.addrTx,
      setRiskPolicy: p3.policyTx,
    },
    provisionedAt: new Date().toISOString(),
    purpose:
      "TrustSwap autonomous-daemon agent identity — Phase 5a (TRU-80). Subname registered + funded by parent owner via MetaMask; ENS records + session key issued by daemon owner key.",
  };

  if (args.dryRun) {
    console.log("  [dry-run] would write:");
    console.log(JSON.stringify(record, null, 2));
    return;
  }

  mkdirSync(dirname(IDENTITY_RECORD_PATH), { recursive: true });
  writeFileSync(IDENTITY_RECORD_PATH, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`  ✓ ${IDENTITY_RECORD_PATH}`);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();

  console.log("provision-daemon — TrustSwap Phase 5a (TRU-80)");
  console.log(`  ENS name:   ${args.ensName}`);
  console.log(
    `  RiskPolicy: minTier=${args.minTier} maxSize=$${args.maxSizeUsd} tokens=${args.tokens.join(",")}`,
  );
  if (args.dryRun) console.log("  [DRY RUN — no on-chain effects]");

  const p1 = await phase1IssueOwnerAndKernel(args);
  await phase2PromptAndVerify(args, p1);
  const p3 = await phase3SetEnsRecords(args, p1);
  const p4 = await phase4IssueSessionKey(args, p1);
  phase5WriteIdentityRecord(args, p1, p3, p4);

  console.log("\nDaemon provisioning complete.");
  console.log("");
  console.log("Next:");
  console.log(`  • commit ${IDENTITY_RECORD_PATH}`);
  console.log(
    "  • run `tru agent run --policy infra/droplet/sample-operating-policy.json --max-iterations 2` (TRU-38)",
  );
}

main().catch((err) => {
  console.error("\n[provision-daemon] failed:", err);
  process.exit(1);
});
