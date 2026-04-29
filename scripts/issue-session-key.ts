#!/usr/bin/env tsx
// Issue the first Namera session key for TrustSwap (TRU-50).
//
// One-time owner-key-required ceremony. Decrypts the owner keystore in
// memory, generates a fresh session-key signer, installs the four onchain
// policies, serializes via `@namera-ai/sdk/session-key`, and writes:
//
//   ~/.synthesis/session-key.json    serialized session-key (mode 0600)
//   .env.local                        NAMERA_SESSION_KEY_* entries (gitignored)
//
// Required env:
//   BUNDLER_URL_BASE              — ERC-4337 bundler URL on Base
//   TRUST_SWAP_ROUTER_ADDRESS     — pinned by `toCallPolicy`
//   NAMERA_KERNEL_ACCOUNT_ADDRESS — sanity-checked against derived address
// Optional env:
//   BASE_RPC_URL                  — defaults to https://mainnet.base.org
//   SYNTHESIS_KEYSTORE_PASSWORD   — bypasses the password prompt
//   NAMERA_SESSION_KEY_VALID_HOURS  — defaults to 24
//
// **Drift constraint** — the session key's `toCallPolicy` is pinned to the
// passed `TRUST_SWAP_ROUTER_ADDRESS`. If the router is ever redeployed at a
// different address, this ceremony MUST re-run; the old session key will
// reject calls to the new router on chain.

import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  scrypt,
  createDecipheriv,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import {
  createPublicClient,
  http,
  isAddress,
  parseAbi,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { createKernelAccount } from "@zerodev/sdk";
import { KERNEL_V3_3, getEntryPoint } from "@zerodev/sdk/constants";
import { toMultiChainECDSAValidator } from "@zerodev/multi-chain-ecdsa-validator";
import { createSessionKey } from "@namera-ai/sdk/session-key";
import {
  toCallPolicy,
  toGasPolicy,
  toRateLimitPolicy,
  toTimestampPolicy,
  CallPolicyVersion,
} from "@zerodev/permissions/policies";

const scryptAsync = promisify<Buffer | string, Buffer | string, number, Buffer>(
  scrypt,
);

async function readPassword(): Promise<string> {
  const fromEnv = process.env.SYNTHESIS_KEYSTORE_PASSWORD;
  if (fromEnv && fromEnv.length >= 8) return fromEnv;
  const rl = createInterface({ input, output, terminal: true });
  const pw = await rl.question("Synthesis keystore password: ");
  rl.close();
  return pw;
}

async function decryptKeystore(
  keystore: any,
  password: string,
): Promise<Hex> {
  const { kdfparams, ciphertext, cipherparams, mac, cipher } = keystore.crypto;
  if (cipher !== "aes-256-ctr" || keystore.crypto.kdf !== "scrypt") {
    throw new Error("unsupported keystore format");
  }
  const dk = await scryptAsync(
    password,
    Buffer.from(kdfparams.salt, "hex"),
    kdfparams.dklen ?? 32,
  );
  const ctBuf = Buffer.from(ciphertext, "hex");
  const expectedMac = createHash("sha256")
    .update(Buffer.concat([dk.subarray(16, 32), ctBuf]))
    .digest();
  if (!timingSafeEqual(expectedMac, Buffer.from(mac, "hex"))) {
    throw new Error("MAC mismatch — wrong password");
  }
  const decipher = createDecipheriv(
    "aes-256-ctr",
    dk,
    Buffer.from(cipherparams.iv, "hex"),
  );
  return `0x${Buffer.concat([decipher.update(ctBuf), decipher.final()]).toString("hex")}` as Hex;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set in env`);
  return v;
}

function appendEnvLocal(lines: string[]): string {
  const path = join(process.cwd(), ".env.local");
  const banner = `\n# Issued by scripts/issue-session-key.ts at ${new Date().toISOString()}\n`;
  const body = lines.join("\n") + "\n";
  if (existsSync(path)) {
    writeFileSync(path, readFileSync(path, "utf-8") + banner + body);
  } else {
    writeFileSync(path, banner.trimStart() + body);
  }
  chmodSync(path, 0o600);
  return path;
}

async function main() {
  const force = process.argv.includes("--force");
  const bundlerUrl = requireEnv("BUNDLER_URL_BASE");
  const rpcUrl = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
  const routerAddress = requireEnv("TRUST_SWAP_ROUTER_ADDRESS") as Address;
  if (!isAddress(routerAddress)) {
    throw new Error(`TRUST_SWAP_ROUTER_ADDRESS not a valid address: ${routerAddress}`);
  }
  const expectedKernel = requireEnv("NAMERA_KERNEL_ACCOUNT_ADDRESS") as Address;

  const validHours = Number(
    process.env.NAMERA_SESSION_KEY_VALID_HOURS ?? "24",
  );
  if (!Number.isFinite(validHours) || validHours <= 0) {
    throw new Error("NAMERA_SESSION_KEY_VALID_HOURS must be a positive number");
  }

  const sessionKeyPath = join(homedir(), ".synthesis", "session-key.json");
  if (!force && existsSync(sessionKeyPath)) {
    console.error(
      `refusing to overwrite ${sessionKeyPath} — pass --force to replace`,
    );
    process.exit(1);
  }

  // --- 1. Decrypt owner keystore in memory --------------------------------
  const keystorePath = join(homedir(), ".synthesis", "keystore.json");
  if (!existsSync(keystorePath)) {
    throw new Error(`owner keystore not found at ${keystorePath}`);
  }
  const keystore = JSON.parse(readFileSync(keystorePath, "utf-8"));
  const password = await readPassword();
  let ownerPrivateKey: Hex | null = await decryptKeystore(keystore, password);

  // --- 2. Build kernel account from owner ---------------------------------
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

  if (account.address.toLowerCase() !== expectedKernel.toLowerCase()) {
    throw new Error(
      `derived kernel address ${account.address} does not match NAMERA_KERNEL_ACCOUNT_ADDRESS=${expectedKernel}`,
    );
  }

  // --- 3. Fresh session-key signer ----------------------------------------
  const sessionPrivateKey = generatePrivateKey();
  const sessionAccount = privateKeyToAccount(sessionPrivateKey);

  // --- 4. Build the four onchain policies ---------------------------------
  const validUntil = Math.floor(Date.now() / 1000) + validHours * 3600;

  // toCallPolicy: pin the session key to call exactly ONE function on
  // exactly ONE address — `gatedSwap(bytes,(...),bytes)` on the deployed
  // TrustSwapRouter. Permission fields don't constrain the calldata args
  // here (the router itself enforces gating); we just lock down the
  // (target, function) pair.
  const ROUTER_ABI = parseAbi([
    "function gatedSwap(bytes universalRouterCalldata, (address swapper, address recipient, uint8 swapperTier, uint8 recipientTier, uint256 expiresAt, uint256 nonce) attestation, bytes oracleSig) external payable",
  ]);
  const callPolicy = toCallPolicy({
    policyVersion: CallPolicyVersion.V0_0_4,
    permissions: [
      {
        target: routerAddress,
        abi: ROUTER_ABI,
        functionName: "gatedSwap",
        valueLimit: parseEther("0.005"), // matches toGasPolicy floor
      },
    ],
  });

  const gasPolicy = toGasPolicy({ allowed: parseEther("0.005") });
  const rateLimitPolicy = toRateLimitPolicy({ count: 1, interval: 3600 });
  const timestampPolicy = toTimestampPolicy({ validUntil });

  // --- 5. Issue the session key via @namera-ai/sdk ------------------------
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

  // --- 6. Wipe owner key from memory --------------------------------------
  ownerPrivateKey = null;

  if (
    !result.serializedAccounts ||
    result.serializedAccounts.length !== 1 ||
    result.serializedAccounts[0].chainId !== base.id
  ) {
    throw new Error(
      `unexpected serializedAccounts shape from createSessionKey: ${JSON.stringify(
        result.serializedAccounts.map((s) => ({ chainId: s.chainId })),
      )}`,
    );
  }
  const serialized = result.serializedAccounts[0].serializedAccount;

  // --- 7. Persist to disk -------------------------------------------------
  writeFileSync(
    sessionKeyPath,
    JSON.stringify(
      {
        version: 1,
        chain: "base",
        chainId: base.id,
        kernelAccount: account.address,
        sessionSigner: sessionAccount.address,
        routerPinned: routerAddress,
        validUntil,
        validUntilISO: new Date(validUntil * 1000).toISOString(),
        serializedAccount: serialized,
        createdAt: new Date().toISOString(),
        purpose: "TrustSwap session key — toCallPolicy pinned to TrustSwapRouter",
      },
      null,
      2,
    ),
  );
  chmodSync(sessionKeyPath, 0o600);

  const envPath = appendEnvLocal([
    `NAMERA_SESSION_KEY_PATH=${sessionKeyPath}`,
    `NAMERA_SESSION_KEY_PRIVATE_KEY=${sessionPrivateKey}`,
    `NAMERA_SESSION_KEY_SIGNER_ADDRESS=${sessionAccount.address}`,
    `NAMERA_SESSION_KEY_VALID_UNTIL=${validUntil}`,
  ]);

  console.log("Session key issued.");
  console.log(`  kernel:           ${account.address}`);
  console.log(`  session signer:   ${sessionAccount.address}`);
  console.log(`  router pinned:    ${routerAddress}`);
  console.log(`  validUntil:       ${new Date(validUntil * 1000).toISOString()}`);
  console.log(`  serialized →      ${sessionKeyPath}`);
  console.log(`  private key →     ${envPath} (mode 0600)`);
  console.log("");
  console.log(`Re-run with --force after ${new Date(validUntil * 1000).toISOString()} or any router redeploy.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
