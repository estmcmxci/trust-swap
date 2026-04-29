#!/usr/bin/env tsx
// Issue the TrustSwap kernel account (Phase 0).
//
// One-time ceremony. Generates a fresh ECDSA owner key, encrypts it into
// ~/.synthesis/keystore.json (scrypt + aes-256-ctr), then derives the
// deterministic kernel-account address using @namera-ai/sdk.
//
// Output:
//   ~/.synthesis/keystore.json        encrypted owner key (mode 0600)
//   ~/.synthesis/kernel.pub.json      owner address + kernel address
//
// The kernel address is the funding target — send ~$5 of Base ETH there.
// The kernel contract isn't deployed until the first user-op, but the address
// is deterministic from (owner, kernelVersion, entrypoint, factory, index=0).
//
// Required env: BUNDLER_URL_BASE, BASE_RPC_URL.
// Optional env: SYNTHESIS_KEYSTORE_PASSWORD (else prompts).

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  scrypt,
  randomBytes,
  createCipheriv,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { createPublicClient, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { createAccountClient } from "@namera-ai/sdk/account";
import { KERNEL_V3_3 } from "@zerodev/sdk/constants";

const scryptAsync = promisify<Buffer | string, Buffer | string, number, Buffer>(
  scrypt,
);

async function readPassword(): Promise<string> {
  const fromEnv = process.env.SYNTHESIS_KEYSTORE_PASSWORD;
  if (fromEnv && fromEnv.length >= 8) return fromEnv;
  const rl = createInterface({ input, output, terminal: true });
  const pw = await rl.question(
    "Set encryption password for owner key (>=8 chars): ",
  );
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

async function main() {
  const force = process.argv.includes("--force");
  const bundlerUrl = process.env.BUNDLER_URL_BASE;
  const rpcUrl = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
  if (!bundlerUrl) {
    console.error("BUNDLER_URL_BASE not set — fill .env first");
    process.exit(1);
  }

  const dir = join(homedir(), ".synthesis");
  const keystorePath = join(dir, "keystore.json");
  const pubPath = join(dir, "kernel.pub.json");

  if (!force && existsSync(keystorePath)) {
    console.error(`refusing to overwrite ${keystorePath} — pass --force to replace`);
    process.exit(1);
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const password = await readPassword();
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

  const kernelAddress = kernelClient.account.address;

  const encrypted = await encryptKey(ownerPrivateKey, password);
  writeFileSync(keystorePath, JSON.stringify(encrypted, null, 2));
  chmodSync(keystorePath, 0o600);

  writeFileSync(
    pubPath,
    JSON.stringify(
      {
        ownerAddress: ownerAccount.address,
        kernelAddress,
        chain: "base",
        chainId: base.id,
        kernelVersion: KERNEL_V3_3,
        entrypointVersion: "0.7",
        index: 0,
        createdAt: new Date().toISOString(),
        purpose: "TrustSwap kernel account — owner key encrypted at ~/.synthesis/keystore.json",
      },
      null,
      2,
    ),
  );

  console.log("kernel account issued");
  console.log(`  owner address:   ${ownerAccount.address}`);
  console.log(`  kernel address:  ${kernelAddress}`);
  console.log(`  encrypted key:   ${keystorePath}`);
  console.log(`  public record:   ${pubPath}`);
  console.log("");
  console.log(`Next: fund ${kernelAddress} with ~$5 of Base ETH (mainnet).`);
  console.log(`Then: set NAMERA_KERNEL_ACCOUNT_ADDRESS=${kernelAddress}`);
  console.log(`      set NAMERA_OWNER_ADDRESS=${ownerAccount.address}`);
  console.log(`      set NAMERA_KEYSTORE_PATH=${keystorePath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
