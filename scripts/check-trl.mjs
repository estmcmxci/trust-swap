import { resolve, resolveIdentity, KNOWN_REGISTRIES, createEnsClient } from "../vendor/synthesis-resolver/dist/index.js";
const RPC = "https://ethereum-rpc.publicnode.com";
const name = "emilemarcelagustin.eth";

console.log("--- with knownAgentIds: ['24994'] ---");
const r1 = await resolve(name, { ensRpcUrl: RPC, knownAgentIds: ["24994"] });
console.log(`  trustScore: ${r1.trustScore}`);
console.log(`  identity.verified: ${r1.identity?.verified}`);
console.log(`  identity.registryAddress: ${r1.identity?.registryAddress}`);
console.log(`  identity.agentId: ${r1.identity?.agentId}`);

console.log("\n--- resolveIdentity directly with knownAgentIds ---");
const client = createEnsClient(RPC);
const id = await resolveIdentity(client, name, { knownAgentIds: ["24994"] });
console.log(JSON.stringify(id, null, 2));

console.log("\n--- KNOWN_REGISTRIES ---");
console.log(JSON.stringify(KNOWN_REGISTRIES, null, 2));
