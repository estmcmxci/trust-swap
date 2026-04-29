#!/usr/bin/env tsx
// Decrypt ~/.trust-swap/oracle.key and print the 0x-prefixed private key to
// stdout. Designed to be piped:
//
//   pnpm oracle:export-key | wrangler secret put ORACLE_PRIVATE_KEY
//
// Prompts on stderr for the password (so stdin/stdout stay clean for piping).
// If the destination is a TTY, refuses to print to keep the key out of
// scrollback.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  scrypt,
  createDecipheriv,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify<Buffer | string, Buffer | string, number, Buffer>(
  scrypt,
);

async function main() {
  if (process.stdout.isTTY && !process.argv.includes("--allow-tty")) {
    console.error(
      "refusing to print private key to a TTY — pipe to a downstream command (e.g. `wrangler secret put`), or pass --allow-tty to override.",
    );
    process.exit(1);
  }

  const keyPath = join(homedir(), ".trust-swap", "oracle.key");
  if (!existsSync(keyPath)) {
    console.error(`oracle key not found at ${keyPath}`);
    process.exit(1);
  }
  const ks = JSON.parse(readFileSync(keyPath, "utf-8"));

  let password = process.env.TRUST_SWAP_ORACLE_PASSWORD;
  if (!password) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: true,
    });
    password = await rl.question("Oracle keystore password: ");
    rl.close();
  }

  const dk = await scryptAsync(
    password,
    Buffer.from(ks.crypto.kdfparams.salt, "hex"),
    ks.crypto.kdfparams.dklen ?? 32,
  );
  const ct = Buffer.from(ks.crypto.ciphertext, "hex");
  const expectedMac = createHash("sha256")
    .update(Buffer.concat([dk.subarray(16, 32), ct]))
    .digest();
  if (!timingSafeEqual(expectedMac, Buffer.from(ks.crypto.mac, "hex"))) {
    console.error("MAC mismatch — wrong password");
    process.exit(1);
  }
  const decipher = createDecipheriv(
    "aes-256-ctr",
    dk,
    Buffer.from(ks.crypto.cipherparams.iv, "hex"),
  );
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  process.stdout.write(`0x${plaintext.toString("hex")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
