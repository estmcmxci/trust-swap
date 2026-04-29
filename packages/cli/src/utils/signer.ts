import { existsSync, readFileSync } from "node:fs";
import {
  createPublicClient,
  http,
  type Hex,
  type Address,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { createLocalSigner, type Batch, type Signer } from "@synthesis/resolver";
import { createKernelAccountClient } from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_3 } from "@zerodev/sdk/constants";
import { deserializePermissionAccount } from "@zerodev/permissions";
import { toECDSASigner } from "@zerodev/permissions/signers";

export type SignerKind = "local" | "namera";

export interface BuildSignerOptions {
  kind?: SignerKind;
  rpcUrl?: string;
  /** When true and ENS_PRIVATE_KEY is missing, generate an ephemeral key. */
  allowEphemeral?: boolean;
}

export interface BuildSignerResult {
  signer: Signer;
  kind: SignerKind;
  /** True when the private key was auto-generated for dry-run. */
  ephemeral: boolean;
}

/**
 * Resolve which signer to build. Default selection: `namera` if all NAMERA_*
 * env vars are present (keystore + session key + session-key private key),
 * else `local`.
 */
export function defaultSignerKind(): SignerKind {
  const hasNamera =
    process.env.NAMERA_KEYSTORE_PATH &&
    process.env.NAMERA_SESSION_KEY_PATH &&
    process.env.NAMERA_SESSION_KEY_PRIVATE_KEY;
  return hasNamera ? "namera" : "local";
}

export async function buildSigner(
  opts: BuildSignerOptions = {},
): Promise<BuildSignerResult> {
  const kind = opts.kind ?? defaultSignerKind();
  const rpcUrl = opts.rpcUrl ?? process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

  if (kind === "namera") {
    return { signer: await buildNameraSigner(rpcUrl), kind, ephemeral: false };
  }

  let privateKey = process.env.ENS_PRIVATE_KEY as `0x${string}` | undefined;
  let ephemeral = false;
  if (!privateKey) {
    if (!opts.allowEphemeral) {
      throw new Error(
        "ENS_PRIVATE_KEY not set — required for --signer local. Pass --dry-run to use an ephemeral key.",
      );
    }
    privateKey = generatePrivateKey();
    ephemeral = true;
  }
  if (!privateKey.startsWith("0x")) {
    throw new Error(`ENS_PRIVATE_KEY must be a 0x-prefixed hex private key`);
  }

  const signer = await createLocalSigner({
    privateKey,
    chain: base,
    rpcUrl,
  });
  return { signer, kind, ephemeral };
}

/**
 * Build a Namera-backed Signer that signs ERC-4337 user-ops via the kernel
 * account's session key, broadcasts through the configured bundler, and
 * exposes the kernel address as `signer.address`.
 *
 * **Why we don't use Namera's `createSessionKeyClient`:** that wrapper
 * destructures the input params and silently drops `userOperation` config —
 * meaning our `estimateFeesPerGas` override never reaches the underlying
 * ZeroDev kernel client. The kernel client then defaults to
 * `zd_getUserOperationGasPrice`, which Pimlico (a ZeroDev-bundler-incompatible
 * provider on the free tier for Base mainnet) rejects with -32601.
 *
 * Bypass: use ZeroDev's `deserializePermissionAccount` + `toECDSASigner`
 * directly to reconstitute the session-key account from the serialized blob,
 * then call `createKernelAccountClient` ourselves with the override applied.
 * Replicates Namera's runtime behavior minus the param-drop bug.
 */
async function buildNameraSigner(rpcUrl: string): Promise<Signer> {
  const sessionKeyPath = required("NAMERA_SESSION_KEY_PATH");
  const sessionKeyPrivateKey = required("NAMERA_SESSION_KEY_PRIVATE_KEY") as Hex;
  const bundlerUrl = required("BUNDLER_URL_BASE");
  if (!existsSync(sessionKeyPath)) {
    throw new Error(`session key file not found: ${sessionKeyPath}`);
  }
  const sessionKeyJson = JSON.parse(readFileSync(sessionKeyPath, "utf-8"));
  const serializedAccount: string = sessionKeyJson.serializedAccount;
  if (typeof serializedAccount !== "string" || serializedAccount.length === 0) {
    throw new Error(`session key file missing serializedAccount: ${sessionKeyPath}`);
  }

  const publicClient = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });
  const sessionSignerAccount = privateKeyToAccount(sessionKeyPrivateKey);
  const ecdsaSessionSigner = await toECDSASigner({ signer: sessionSignerAccount });

  const entryPoint = getEntryPoint("0.7");
  const sessionKeyAccount = await deserializePermissionAccount(
    publicClient,
    entryPoint,
    KERNEL_V3_3,
    serializedAccount,
    ecdsaSessionSigner,
  );

  const sessionKeyClient = createKernelAccountClient({
    account: sessionKeyAccount,
    bundlerTransport: http(bundlerUrl),
    chain: base,
    client: publicClient,
    userOperation: {
      // Pimlico-native gas-tier RPC. Without this, the kernel client
      // calls ZeroDev's `zd_getUserOperationGasPrice` which Pimlico
      // rejects with method-not-found.
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

  const kernelAddress = sessionKeyClient.account.address as Address;

  return {
    address: kernelAddress,
    async execute(batches: Batch[]): Promise<`0x${string}`> {
      // Single-batch path is the common case (gatedSwap is one call). For
      // multi-batch we serialize sequentially — atomic-batch flag inside a
      // single batch maps to the kernel's executeBatch.
      let lastTxHash: `0x${string}` | undefined;
      for (const batch of batches) {
        if (batch.chainId !== base.id) {
          throw new Error(
            `namera signer is pinned to Base (chainId ${base.id}); refusing batch on chainId ${batch.chainId}`,
          );
        }
        const userOpHash = await sessionKeyClient.sendUserOperation({
          calls: batch.calls.map((c) => ({
            to: c.to,
            data: c.data,
            value: c.value,
          })),
        });
        const receipt = await sessionKeyClient.waitForUserOperationReceipt({
          hash: userOpHash,
        });
        if (!receipt.success) {
          throw new Error(
            `namera signer: user-op ${userOpHash} reverted on-chain (txHash ${receipt.receipt.transactionHash})`,
          );
        }
        lastTxHash = receipt.receipt.transactionHash;
      }
      if (!lastTxHash) {
        throw new Error("namera signer: no batches executed");
      }
      return lastTxHash;
    },
  };
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} not set — required for --signer namera`);
  }
  return v;
}

/** Truthy iff the file at the path exists and is readable. */
export function keystoreFileExists(path: string | undefined): boolean {
  if (!path) return false;
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}
