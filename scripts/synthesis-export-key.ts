#!/usr/bin/env tsx
// Decrypt ~/.synthesis/keystore.json and print the 0x-prefixed private key
// to stdout. Mirror of `scripts/oracle-export-key.ts` for the kernel owner
// key. Used to feed `forge script --private-key $(pnpm --silent
// synthesis:export-key)` and similar pipelines.
//
// Refuses to print to a TTY by default — pipe to a downstream consumer or
// pass `--allow-tty` to override.

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
      "refusing to print private key to a TTY — pipe to a downstream command, or pass --allow-tty.",
    );
    process.exit(1);
  }

  const keyPath = join(homedir(), ".synthesis", "keystore.json");
  if (!existsSync(keyPath)) {
    console.error(`synthesis keystore not found at ${keyPath}`);
    process.exit(1);
  }
  const ks = JSON.parse(readFileSync(keyPath, "utf-8"));

  let password = process.env.SYNTHESIS_KEYSTORE_PASSWORD;
  if (!password) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: true,
    });
    password = await rl.question("Synthesis keystore password: ");
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
