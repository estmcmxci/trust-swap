#!/usr/bin/env tsx
// Generate the TrustSwap oracle keypair.
//
// Writes:
//   ~/.trust-swap/oracle.key       (encrypted private key, mode 0600)
//   ~/.trust-swap/oracle.pub.json  (address + public metadata, world-readable)
//
// The encrypted private key is a viem-style JSON keystore (scrypt). Pass the
// password via TRUST_SWAP_ORACLE_PASSWORD or the script will prompt.
//
// Run once. Re-running aborts unless --force is passed.

import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { scrypt, randomBytes, createCipheriv, createHash } from "node:crypto";
import { promisify } from "node:util";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const scryptAsync = promisify<Buffer | string, Buffer | string, number, Buffer>(
  scrypt,
);

async function readPassword(): Promise<string> {
  const fromEnv = process.env.TRUST_SWAP_ORACLE_PASSWORD;
  if (fromEnv && fromEnv.length >= 8) return fromEnv;
  const rl = createInterface({ input, output, terminal: true });
  const pw = await rl.question(
    "Set encryption password for oracle private key (>=8 chars): ",
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
  const dir = join(homedir(), ".trust-swap");
  const keyPath = join(dir, "oracle.key");
  const pubPath = join(dir, "oracle.pub.json");

  if (!force && existsSync(keyPath)) {
    console.error(`refusing to overwrite ${keyPath} — pass --force to replace`);
    process.exit(1);
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const password = await readPassword();
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const encrypted = await encryptKey(privateKey, password);

  writeFileSync(keyPath, JSON.stringify(encrypted, null, 2));
  chmodSync(keyPath, 0o600);
  writeFileSync(
    pubPath,
    JSON.stringify(
      {
        address: account.address,
        publicKey: account.publicKey,
        createdAt: new Date().toISOString(),
        purpose: "TrustSwapRouter oracle signing key",
      },
      null,
      2,
    ),
  );

  console.log(`oracle keypair generated`);
  console.log(`  address:        ${account.address}`);
  console.log(`  encrypted key:  ${keyPath}`);
  console.log(`  public record:  ${pubPath}`);
  console.log(``);
  console.log(`record this address — it becomes ORACLE_PUBKEY in the router constructor.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
