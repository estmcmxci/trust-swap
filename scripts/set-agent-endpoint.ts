#!/usr/bin/env tsx
// Set the `agent-endpoint` ENS text record on a daemon subname, signed by
// the daemon owner key (which lives encrypted at ~/.synthesis/<slug>-keystore.json
// and is the *subname's* registry owner — not the parent ENS owner).
//
// Why this exists: `ensemble edit txt` signs with whatever key the CLI is
// configured with (the parent owner, in our setup). Subname text records
// must be signed by the subname's own owner, so we decrypt the daemon
// keystore and call `setText` directly.
//
// Read by `resolveRiskPolicy` (packages/core/src/risk-policy.ts) and the
// upcoming Phase 6c A2A poll loop, which will GET <endpoint> to see what
// intents a peer is currently advertising.
//
// Required env: ETH_RPC_URL (or MAINNET_RPC_URL).
// Optional: SYNTHESIS_DAEMON_KEYSTORE_PASSWORD (else prompts).
//
// Usage:
//   pnpm tsx scripts/set-agent-endpoint.ts \
//     --ens-name daemon.trustrust.eth \
//     --endpoint http://100.121.243.97:18791/intents

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
  createWalletClient,
  http,
  namehash,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

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

const ENS_REGISTRY: Address = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";

const ENS_REGISTRY_ABI = parseAbi([
  "function resolver(bytes32 node) view returns (address)",
]);

const RESOLVER_ABI = parseAbi([
  "function setText(bytes32 node, string key, string value)",
  "function text(bytes32 node, string key) view returns (string)",
]);

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

// Mirrors `pathsFor` in scripts/provision-daemon.ts. Legacy
// `daemon.emilemarcelagustin.eth` keeps the un-prefixed `daemon` slug.
function keystorePathFor(ensName: string): string {
  const dot = ensName.indexOf(".");
  if (dot === -1) {
    throw new Error(`--ens-name must be a subdomain (got "${ensName}")`);
  }
  const subnameLabel = ensName.slice(0, dot);
  const parentEnsName = ensName.slice(dot + 1);
  const isLegacyDaemon =
    subnameLabel === "daemon" && parentEnsName === "emilemarcelagustin.eth";
  const parentFirstLabel = parentEnsName.slice(0, parentEnsName.indexOf("."));
  const slug = isLegacyDaemon
    ? "daemon"
    : `${subnameLabel}-${parentFirstLabel}`;
  const safeSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return join(homedir(), ".synthesis", `${safeSlug}-keystore.json`);
}

interface ParsedArgs {
  ensName: string;
  endpoint: string;
}

function parseArgs(): ParsedArgs {
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    if (i === -1) return undefined;
    return argv[i + 1];
  };
  const ensName = get("--ens-name");
  const endpoint = get("--endpoint");
  if (!ensName) throw new Error("--ens-name <subname> required");
  if (!endpoint) throw new Error("--endpoint <url> required");
  // Sanity: must parse as http(s) URL. Resolver consumers call fetch on it.
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error(`--endpoint is not a valid URL: ${endpoint}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`--endpoint must be http(s): got ${parsed.protocol}`);
  }
  return { ensName, endpoint };
}

async function main() {
  const { ensName, endpoint } = parseArgs();
  const ensRpcUrl = process.env.ETH_RPC_URL ?? process.env.MAINNET_RPC_URL;
  if (!ensRpcUrl) {
    throw new Error("ETH_RPC_URL (or MAINNET_RPC_URL) not set");
  }
  const transport = http(ensRpcUrl);
  const publicClient = createPublicClient({ chain: mainnet, transport });

  const node = namehash(ensName);
  const resolverAddress = await publicClient.readContract({
    address: ENS_REGISTRY,
    abi: ENS_REGISTRY_ABI,
    functionName: "resolver",
    args: [node],
  });
  if (resolverAddress === zeroAddress) {
    throw new Error(
      `${ensName} has no resolver set — re-create the subname with the default Public Resolver`,
    );
  }

  const current = await publicClient.readContract({
    address: resolverAddress,
    abi: RESOLVER_ABI,
    functionName: "text",
    args: [node, "agent-endpoint"],
  });
  if (current === endpoint) {
    console.log(`  ✓ agent-endpoint already set to ${endpoint} — nothing to do`);
    return;
  }
  if (current) {
    console.log(`  current agent-endpoint: ${current}`);
  }

  const keystorePath = keystorePathFor(ensName);
  if (!existsSync(keystorePath)) {
    throw new Error(`daemon keystore not found at ${keystorePath}`);
  }

  const password = await readPassword();
  const keystore = JSON.parse(readFileSync(keystorePath, "utf-8"));
  let ownerPrivateKey: Hex | null = await decryptKeystore(keystore, password);
  const account = privateKeyToAccount(ownerPrivateKey);
  console.log(`  signer (subname owner): ${account.address}`);

  const balance = await publicClient.getBalance({ address: account.address });
  const minBalance = 300_000_000_000_000n; // 0.0003 ETH — covers ~50k-gas setText at ≤6 gwei
  if (balance < minBalance) {
    throw new Error(
      `signer ${account.address} has ${balance} wei mainnet ETH, need ≥ ${minBalance} (≈0.0003 ETH) to setText. Fund and retry.`,
    );
  }

  const walletClient = createWalletClient({
    chain: mainnet,
    account,
    transport,
  });

  console.log(`  setText("agent-endpoint", "${endpoint}") on ${ensName}`);
  const tx = await walletClient.writeContract({
    address: resolverAddress,
    abi: RESOLVER_ABI,
    functionName: "setText",
    args: [node, "agent-endpoint", endpoint],
  });
  console.log(`  tx submitted: ${tx}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success") {
    throw new Error(`setText reverted (tx ${tx})`);
  }
  console.log(`  ✓ confirmed in block ${receipt.blockNumber}`);
  console.log(`  etherscan: https://etherscan.io/tx/${tx}`);

  ownerPrivateKey = null;
}

main().catch((err) => {
  console.error("\n[set-agent-endpoint] failed:", err);
  process.exit(1);
});
