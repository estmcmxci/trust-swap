import { createPublicClient, http, namehash } from "viem";
import { mainnet } from "viem/chains";

const RPC = "https://ethereum-rpc.publicnode.com";
const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const REGISTRY_ABI = [{
  name: "resolver", type: "function", stateMutability: "view",
  inputs: [{ name: "node", type: "bytes32" }],
  outputs: [{ name: "", type: "address" }],
}];
const RESOLVER_ABI = [{
  name: "text", type: "function", stateMutability: "view",
  inputs: [{ name: "node", type: "bytes32" }, { name: "key", type: "string" }],
  outputs: [{ name: "", type: "string" }],
}, {
  name: "addr", type: "function", stateMutability: "view",
  inputs: [{ name: "node", type: "bytes32" }],
  outputs: [{ name: "", type: "address" }],
}];

const client = createPublicClient({ chain: mainnet, transport: http(RPC) });
const names = ["daemon.trustrust.eth", "daemon.emilemarcelagustin.eth"];
const keys = ["agent-ids", "agent-version-lineage", "agent-latest", "agent-endpoint", "agent-risk-policy"];

for (const name of names) {
  const node = namehash(name);
  const resolver = await client.readContract({ address: ENS_REGISTRY, abi: REGISTRY_ABI, functionName: "resolver", args: [node] });
  const addr = await client.readContract({ address: resolver, abi: RESOLVER_ABI, functionName: "addr", args: [node] }).catch((e) => `err: ${e.shortMessage ?? e.message}`);
  console.log(`\n=== ${name} ===`);
  console.log(`  node: ${node}`);
  console.log(`  resolver: ${resolver}`);
  console.log(`  addr: ${addr}`);
  for (const key of keys) {
    const val = await client.readContract({ address: resolver, abi: RESOLVER_ABI, functionName: "text", args: [node, key] }).catch((e) => `err: ${e.shortMessage ?? e.message}`);
    const display = typeof val === "string" && val.length > 80 ? val.slice(0, 77) + "..." : val;
    console.log(`  text[${key}]: ${val === "" ? "(empty)" : display}`);
  }
}
