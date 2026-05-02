#!/usr/bin/env tsx
// Decrypt a TrustSwap daemon keystore and run a command with the
// resulting private key exported as `ENS_PRIVATE_KEY` (the env var the
// synthesis `ensemble` CLI reads).
//
// Why this exists: ensemble's writable commands (`agent register`,
// `agent link`, `context set`, `edit txt …`) sign with whatever key is
// in `ENS_PRIVATE_KEY`. Our daemon owner keys live encrypted in
// `~/.synthesis/<slug>-keystore.json` (mode 0600, scrypt + aes-256-ctr,
// matching scripts/provision-daemon.ts). This wrapper bridges the two:
// prompt for the password (or read from `SYNTHESIS_DAEMON_KEYSTORE_PASSWORD`),
// decrypt in memory, spawn the child command with `ENS_PRIVATE_KEY` set,
// and never write the plaintext key to disk or scroll it past the
// terminal.
//
// Usage:
//   pnpm tsx scripts/run-with-daemon-key.ts \
//     --keystore ~/.synthesis/daemon-trustrust-keystore.json \
//     -- ensemble agent register daemon.trustrust.eth --link true --chain base

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawn } from "node:child_process";
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
): Promise<string> {
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
  return `0x${Buffer.concat([decipher.update(ctBuf), decipher.final()]).toString("hex")}`;
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env.SYNTHESIS_DAEMON_KEYSTORE_PASSWORD;
  if (fromEnv && fromEnv.length >= 8) return fromEnv;
  const rl = createInterface({ input, output, terminal: true });
  const pw = await rl.question("Daemon keystore password: ");
  rl.close();
  return pw;
}

function expandHome(path: string): string {
  if (path.startsWith("~/")) return `${homedir()}${path.slice(1)}`;
  return path;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const sepIdx = argv.indexOf("--");
  if (sepIdx === -1) {
    throw new Error(
      "expected `-- <command...>` separator. Example:\n" +
        "  pnpm tsx scripts/run-with-daemon-key.ts \\\n" +
        "    --keystore ~/.synthesis/daemon-trustrust-keystore.json \\\n" +
        "    -- ensemble agent register daemon.trustrust.eth --link true",
    );
  }
  const flags = argv.slice(0, sepIdx);
  const childArgv = argv.slice(sepIdx + 1);
  if (childArgv.length === 0) throw new Error("missing command after `--`");

  const ksFlag = flags.indexOf("--keystore");
  if (ksFlag === -1 || !flags[ksFlag + 1]) {
    throw new Error("--keystore <path> required");
  }
  const keystorePath = expandHome(flags[ksFlag + 1]);
  if (!existsSync(keystorePath)) {
    throw new Error(`keystore not found: ${keystorePath}`);
  }

  const password = await readPassword();
  const keystore = JSON.parse(readFileSync(keystorePath, "utf-8"));
  let privateKey: string | null = await decryptKeystore(keystore, password);

  const [cmd, ...cmdArgs] = childArgv;
  console.error(`(running with ENS_PRIVATE_KEY from ${keystorePath})`);
  const child = spawn(cmd, cmdArgs, {
    stdio: "inherit",
    env: { ...process.env, ENS_PRIVATE_KEY: privateKey },
  });
  // Zero out our reference once the child has it via env.
  privateKey = null;

  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exit(code ?? 0);
      resolve();
    });
  });
}

main().catch((err) => {
  console.error(`\n[run-with-daemon-key] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
