#!/usr/bin/env tsx
// Withdraw ETH from the TrustSwap kernel account.
//
// Decrypts the owner key from ~/.synthesis/keystore.json, reconstitutes the
// kernel account client (same deterministic address as issuance), and issues
// a user-op that transfers ETH out of the kernel.
//
// Usage:
//   pnpm kernel:withdraw --to <0x...> --amount <ether>
//   pnpm kernel:withdraw --to <0x...> --drain        (send balance minus gas buffer)
//
// Required env: BUNDLER_URL_BASE, BASE_RPC_URL.
// Optional env: SYNTHESIS_KEYSTORE_PASSWORD (else prompts).

import { existsSync, readFileSync } from "node:fs";
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
  parseEther,
  formatEther,
  isAddress,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import {
  createKernelAccount,
  createKernelAccountClient,
} from "@zerodev/sdk";
import { KERNEL_V3_3, getEntryPoint } from "@zerodev/sdk/constants";
import { toMultiChainECDSAValidator } from "@zerodev/multi-chain-ecdsa-validator";

const scryptAsync = promisify<Buffer | string, Buffer | string, number, Buffer>(
  scrypt,
);

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    to: get("--to") as `0x${string}` | undefined,
    amount: get("--amount"),
    drain: args.includes("--drain"),
  };
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env.SYNTHESIS_KEYSTORE_PASSWORD;
  if (fromEnv) return fromEnv;
  const rl = createInterface({ input, output, terminal: true });
  const pw = await rl.question("Keystore password: ");
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
  const plaintext = Buffer.concat([decipher.update(ctBuf), decipher.final()]);
  return `0x${plaintext.toString("hex")}` as Hex;
}

async function main() {
  const { to, amount, drain } = parseArgs();
  if (!to || !isAddress(to)) {
    console.error("missing or invalid --to <0x...>");
    process.exit(1);
  }
  if (!drain && !amount) {
    console.error("specify either --amount <ether> or --drain");
    process.exit(1);
  }
  const bundlerUrl = process.env.BUNDLER_URL_BASE;
  const rpcUrl = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
  if (!bundlerUrl) {
    console.error("BUNDLER_URL_BASE not set");
    process.exit(1);
  }

  const keystorePath = join(homedir(), ".synthesis", "keystore.json");
  if (!existsSync(keystorePath)) {
    console.error(`keystore not found at ${keystorePath}`);
    process.exit(1);
  }
  const keystore = JSON.parse(readFileSync(keystorePath, "utf-8"));
  const password = await readPassword();
  const ownerPrivateKey = await decryptKeystore(keystore, password);
  const ownerAccount = privateKeyToAccount(ownerPrivateKey);

  const publicClient = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });

  // Bypass @namera-ai/sdk's createAccountClient — it silently drops the
  // `userOperation` override config. Build the ZeroDev kernel client directly
  // using the same validator (toMultiChainECDSAValidator) so the kernel
  // address matches what was issued at Phase 0.
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
  const kernelClient = createKernelAccountClient({
    account,
    bundlerTransport: http(bundlerUrl),
    chain: base,
    client: publicClient,
    userOperation: {
      // Pimlico doesn't implement zd_getUserOperationGasPrice; use Pimlico's
      // native AA-aware gas-tier RPC instead.
      estimateFeesPerGas: async ({ bundlerClient }) => {
        const gasPrice = (await bundlerClient.request({
          method: "pimlico_getUserOperationGasPrice" as never,
          params: [],
        })) as {
          standard: { maxFeePerGas: Hex; maxPriorityFeePerGas: Hex };
        };
        return {
          maxFeePerGas: BigInt(gasPrice.standard.maxFeePerGas),
          maxPriorityFeePerGas: BigInt(gasPrice.standard.maxPriorityFeePerGas),
        };
      },
    },
  });

  const kernelAddress = kernelClient.account.address;
  const balance = await publicClient.getBalance({ address: kernelAddress });

  console.log(`kernel address:  ${kernelAddress}`);
  console.log(`current balance: ${formatEther(balance)} ETH`);
  console.log(`recipient:       ${to}`);

  if (balance === 0n) {
    console.error("kernel balance is zero — nothing to withdraw");
    process.exit(1);
  }

  let value: bigint;
  if (drain) {
    // Reserve a conservative gas buffer. First user-op also pays kernel
    // deployment (~150k gas). At Base fees this is roughly 0.0002 ETH;
    // reserve 0.0005 ETH to be safe.
    const buffer = parseEther("0.0005");
    if (balance <= buffer) {
      console.error(
        `balance ${formatEther(balance)} ETH below gas buffer ${formatEther(buffer)} ETH — fund more before draining`,
      );
      process.exit(1);
    }
    value = balance - buffer;
    console.log(`drain mode:      sending ${formatEther(value)} ETH (reserving ${formatEther(buffer)} for gas)`);
  } else {
    value = parseEther(amount as string);
    if (value >= balance) {
      console.error(
        `requested ${formatEther(value)} ETH ≥ balance ${formatEther(balance)} ETH — leave room for gas`,
      );
      process.exit(1);
    }
    console.log(`amount mode:     sending ${formatEther(value)} ETH`);
  }

  console.log("submitting user-op...");
  const userOpHash = await kernelClient.sendUserOperation({
    calls: [{ to, value, data: "0x" as Hex }],
  });
  console.log(`userOpHash: ${userOpHash}`);

  console.log("waiting for receipt...");
  const receipt = await kernelClient.waitForUserOperationReceipt({
    hash: userOpHash,
  });

  console.log("");
  console.log(receipt.success ? "withdraw OK" : "withdraw FAILED");
  console.log(`  txHash:       ${receipt.receipt.transactionHash}`);
  console.log(`  block:        ${receipt.receipt.blockNumber}`);
  console.log(`  basescan:     https://basescan.org/tx/${receipt.receipt.transactionHash}`);

  const newBalance = await publicClient.getBalance({ address: kernelAddress });
  console.log(`  new balance:  ${formatEther(newBalance)} ETH`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
