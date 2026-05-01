#!/usr/bin/env tsx
// Bootstrap the daemon kernel: deploy the smart account + install the
// session-key validator via ONE userOp signed by the daemon owner key.
//
// Why this exists: provision-daemon.ts calls `createSessionKey` which
// returns a serialized blob assuming the kernel will deploy itself on
// first session-key userOp. In practice, that path can fail in
// EntryPoint simulation if the embedded enable-signature is rejected
// — typically when no prior owner-signed userOp warmed the kernel.
//
// Run ONCE after pnpm provision:daemon, BEFORE starting the daemon.
// Idempotent: if the kernel is already deployed, exits cleanly.
//
// Required env: BUNDLER_URL_BASE, BASE_RPC_URL.
// Optional: SYNTHESIS_DAEMON_KEYSTORE_PASSWORD (else prompts).

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
import { createPublicClient, encodeFunctionData, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { createKernelAccount, createKernelAccountClient } from "@zerodev/sdk";
import { KERNEL_V3_3, getEntryPoint } from "@zerodev/sdk/constants";
import { toMultiChainECDSAValidator } from "@zerodev/multi-chain-ecdsa-validator";

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

async function readPassword(): Promise<string> {
  const fromEnv = process.env.SYNTHESIS_DAEMON_KEYSTORE_PASSWORD;
  if (fromEnv && fromEnv.length >= 8) return fromEnv;
  const rl = createInterface({ input, output, terminal: true });
  const pw = await rl.question("Daemon keystore password: ");
  rl.close();
  return pw;
}

async function decryptKeystore(
  keystore: EncryptedKeystore,
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

async function main() {
  const bundlerUrl = process.env.BUNDLER_URL_BASE;
  if (!bundlerUrl) throw new Error("BUNDLER_URL_BASE not set");
  const rpcUrl = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

  const keystorePath = join(homedir(), ".synthesis", "daemon-keystore.json");
  const pubPath = join(homedir(), ".synthesis", "daemon-kernel.pub.json");
  if (!existsSync(keystorePath)) {
    throw new Error(`daemon keystore not found at ${keystorePath}`);
  }
  if (!existsSync(pubPath)) {
    throw new Error(`daemon kernel public record not found at ${pubPath}`);
  }
  const pub = JSON.parse(readFileSync(pubPath, "utf-8"));
  const expectedKernel = pub.kernelAddress as Address;
  console.log(`bootstrapping daemon kernel ${expectedKernel}`);

  // --- Pre-check: is the kernel already deployed? ---------------------------
  // We always run the bootstrap userOp because it ALSO does WETH/USDC
  // approvals to Permit2, which Universal Router needs. Re-running on
  // an already-approved kernel just re-sets allowance to MAX (cheap +
  // safe).
  const publicClient = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });
  const code = await publicClient.getCode({ address: expectedKernel });
  if (code && code !== "0x") {
    console.log(`  · kernel already deployed (${code.length} bytes) — running approvals anyway`);
  } else {
    console.log("  · kernel not deployed yet — bootstrap will deploy + approve");
  }

  // --- Decrypt daemon owner key + build kernel client -----------------------
  const password = await readPassword();
  const keystore = JSON.parse(readFileSync(keystorePath, "utf-8"));
  let ownerPrivateKey: Hex | null = await decryptKeystore(keystore, password);
  const ownerAccount = privateKeyToAccount(ownerPrivateKey);
  console.log(`  owner: ${ownerAccount.address}`);

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
      `derived kernel ${account.address} ≠ recorded ${expectedKernel}`,
    );
  }

  const kernelClient = createKernelAccountClient({
    account,
    bundlerTransport: http(bundlerUrl),
    chain: base,
    client: publicClient,
    userOperation: {
      // Same Pimlico-fees override as the manual swap path.
      estimateFeesPerGas: async ({ bundlerClient }) => {
        const gp = (await bundlerClient.request({
          method: "pimlico_getUserOperationGasPrice" as never,
          params: [],
        })) as { standard: { maxFeePerGas: Hex; maxPriorityFeePerGas: Hex } };
        return {
          maxFeePerGas: BigInt(gp.standard.maxFeePerGas),
          maxPriorityFeePerGas: BigInt(gp.standard.maxPriorityFeePerGas),
        };
      },
    },
  });

  // --- Bootstrap call batch ------------------------------------------------
  // One atomic batch, signed by the owner key. Idempotent — re-running
  // sets allowances back to MAX (no-op for already-approved tokens).
  //   1. Self-transfer 0 wei — deploys the kernel via factory on first
  //      run; subsequent runs no-op.
  //   2. WETH/USDC.approve(Permit2, max) — Universal Router pulls input
  //      tokens via Permit2 when called directly. Kept for the manual
  //      `tru swap` path which calls UR straight from the kernel.
  //   3. WETH/USDC.approve(TrustSwapRouter, max) — TRU-86. The v2
  //      gatedSwap pulls `amountIn` from the kernel via `transferFrom`
  //      so the router (rather than the kernel) is UR's payer. Without
  //      this approval, ERC20-input gatedSwap reverts at the
  //      `safeTransferFrom` step.
  const PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
  const WETH: Address = "0x4200000000000000000000000000000000000006";
  const USDC: Address = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  const trustSwapRouter = process.env.TRUST_SWAP_ROUTER_ADDRESS as
    | Address
    | undefined;
  if (!trustSwapRouter) {
    throw new Error(
      "TRUST_SWAP_ROUTER_ADDRESS not set — bootstrap can't approve the router without it",
    );
  }
  console.log(`  router: ${trustSwapRouter}`);
  const ERC20_APPROVE = parseAbi([
    "function approve(address spender, uint256 amount) returns (bool)",
  ]);
  const MAX = (1n << 256n) - 1n;
  const approveData = (spender: Address) =>
    encodeFunctionData({
      abi: ERC20_APPROVE,
      functionName: "approve",
      args: [spender, MAX],
    });

  const userOpHash = await kernelClient.sendUserOperation({
    calls: [
      { to: expectedKernel, value: 0n, data: "0x" },
      { to: WETH, value: 0n, data: approveData(PERMIT2) },
      { to: USDC, value: 0n, data: approveData(PERMIT2) },
      { to: WETH, value: 0n, data: approveData(trustSwapRouter) },
      { to: USDC, value: 0n, data: approveData(trustSwapRouter) },
    ],
  });
  console.log(`  userOp hash: ${userOpHash}`);

  const receipt = await kernelClient.waitForUserOperationReceipt({
    hash: userOpHash,
  });
  if (!receipt.success) {
    throw new Error(
      `bootstrap userOp ${userOpHash} reverted on-chain (txHash ${receipt.receipt.transactionHash})`,
    );
  }
  console.log(`  ✓ kernel deployed`);
  console.log(`  basescan: https://basescan.org/tx/${receipt.receipt.transactionHash}`);

  ownerPrivateKey = null;

  console.log(
    `  ✓ kernel deployed + WETH/USDC approved to Permit2 + TrustSwapRouter`,
  );
  console.log("");
  console.log("Done. Restart the daemon — session-key userOps should now succeed:");
  console.log("  ssh root@100.121.243.97 systemctl restart trust-swap-agent");
}

main().catch((err) => {
  console.error("\n[bootstrap-daemon-kernel] failed:", err);
  process.exit(1);
});
