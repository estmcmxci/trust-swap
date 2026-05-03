// src/layers/personhood.ts
import { createPublicClient, http, toHex } from "viem";
import { base, worldchain } from "viem/chains";
var AGENT_BOOK_ABI = [
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "lookupHuman",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  }
];
var AGENT_BOOK_DEPLOYMENTS = {
  base: {
    address: "0xE1D1D3526A6FAa37eb36bD10B933C1b77f4561a4",
    chain: base
  },
  world: {
    address: "0xA23aB2712eA7BBa896930544C7d6636a96b944dA",
    chain: worldchain
  },
  "base-sepolia": {
    address: "0xA23aB2712eA7BBa896930544C7d6636a96b944dA",
    chain: base
    // uses base chain config with sepolia RPC override
  }
};
async function resolvePersonhood(address, options = {}) {
  const networks = options.networks ?? ["base", "world"];
  for (const network of networks) {
    const deployment = AGENT_BOOK_DEPLOYMENTS[network];
    if (!deployment) continue;
    try {
      const client = createPublicClient({
        chain: deployment.chain,
        transport: http(options.rpcUrl)
      });
      const humanId = await client.readContract({
        address: deployment.address,
        abi: AGENT_BOOK_ABI,
        functionName: "lookupHuman",
        args: [address]
      });
      if (humanId !== 0n) {
        return {
          verified: true,
          nullifierHash: toHex(humanId),
          network,
          agentBookAddress: deployment.address
        };
      }
    } catch {
      continue;
    }
  }
  return {
    verified: false,
    nullifierHash: null,
    network: null,
    agentBookAddress: null
  };
}

// src/layers/identity.ts
import { createPublicClient as createPublicClient3, http as http3 } from "viem";
import { base as base2 } from "viem/chains";

// src/utils/ens.ts
import {
  createPublicClient as createPublicClient2,
  http as http2,
  namehash,
  zeroAddress
} from "viem";
import { labelhash, normalize } from "viem/ens";
import { mainnet } from "viem/chains";
var DEFAULT_RPC = "https://eth.drpc.org";
var ENS_REGISTRY_ADDRESS = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
var NAME_WRAPPER_ADDRESS = "0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401";
var BASE_REGISTRAR_ADDRESS = "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85";
var REGISTRY_ABI = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }]
  }
];
var NAME_WRAPPER_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "address" }]
  }
];
var BASE_REGISTRAR_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }]
  }
];
function createEnsClient(rpcUrl) {
  const url = rpcUrl ?? process.env.ETH_RPC_URL ?? DEFAULT_RPC;
  return createPublicClient2({
    chain: mainnet,
    transport: http2(url)
  });
}
function normalizeName(name) {
  return normalize(name);
}
async function getTextRecord(client, name, key) {
  try {
    const value = await client.getEnsText({
      name: normalizeName(name),
      key
    });
    return value ?? null;
  } catch {
    return null;
  }
}
async function getTextRecords(client, name, keys) {
  const normalized = normalizeName(name);
  const results = await Promise.all(
    keys.map(async (key) => {
      try {
        const value = await client.getEnsText({ name: normalized, key });
        return [key, value ?? null];
      } catch {
        return [key, null];
      }
    })
  );
  const records = {};
  for (const [key, value] of results) {
    if (value !== null) {
      records[key] = value;
    }
  }
  return records;
}
async function resolveAddress(client, name) {
  try {
    const address = await client.getEnsAddress({
      name: normalizeName(name)
    });
    return address ?? null;
  } catch {
    return null;
  }
}
async function getOwner(client, name) {
  try {
    const normalized = normalizeName(name);
    const node = namehash(normalized);
    const registryOwner = await client.readContract({
      address: ENS_REGISTRY_ADDRESS,
      abi: REGISTRY_ABI,
      functionName: "owner",
      args: [node]
    });
    if (registryOwner === zeroAddress) return null;
    if (registryOwner.toLowerCase() === NAME_WRAPPER_ADDRESS.toLowerCase()) {
      const wrappedOwner = await client.readContract({
        address: NAME_WRAPPER_ADDRESS,
        abi: NAME_WRAPPER_ABI,
        functionName: "ownerOf",
        args: [BigInt(node)]
      });
      return wrappedOwner === zeroAddress ? null : wrappedOwner;
    }
    if (registryOwner.toLowerCase() === BASE_REGISTRAR_ADDRESS.toLowerCase()) {
      const labels = normalized.split(".");
      if (labels.length !== 2 || labels[1] !== "eth") return null;
      const baseOwner = await client.readContract({
        address: BASE_REGISTRAR_ADDRESS,
        abi: BASE_REGISTRAR_ABI,
        functionName: "ownerOf",
        args: [BigInt(labelhash(labels[0]))]
      });
      return baseOwner === zeroAddress ? null : baseOwner;
    }
    return registryOwner;
  } catch {
    return null;
  }
}

// src/utils/erc7930.ts
var VERSION = "0001";
var CHAIN_TYPE_EVM = "0000";
var EVM_ADDR_LENGTH = "14";
function encodeErc7930Address(chainId, contractAddress) {
  const addr = contractAddress.replace("0x", "").toLowerCase();
  const chainHex = chainId.toString(16);
  const chainRef = chainHex.length % 2 ? "0" + chainHex : chainHex;
  const chainRefLen = (chainRef.length / 2).toString(16).padStart(2, "0");
  return VERSION + CHAIN_TYPE_EVM + chainRefLen + chainRef + EVM_ADDR_LENGTH + addr;
}
function decodeErc7930Address(encoded) {
  const hex = encoded.replace("0x", "").toLowerCase();
  const bytes = hexToBytes(hex);
  if (!bytes || bytes.length < 7) return null;
  if (bytes[0] !== 0 || bytes[1] !== 1) return null;
  if (bytes[2] !== 0 || bytes[3] !== 0) return null;
  const chainRefLen = bytes[4];
  const chainRefStart = 5;
  const chainRefEnd = chainRefStart + chainRefLen;
  if (chainRefEnd >= bytes.length) return null;
  let chainId = 0;
  for (let i = chainRefStart; i < chainRefEnd; i++) {
    chainId = chainId << 8 | bytes[i];
  }
  const addrLen = bytes[chainRefEnd];
  const addrStart = chainRefEnd + 1;
  const addrEnd = addrStart + addrLen;
  if (addrEnd > bytes.length) return null;
  const addrBytes = bytes.slice(addrStart, addrEnd);
  const address = "0x" + addrBytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return { chainId, address };
}
function buildEnsip25Key(chainId, registryAddress, agentId) {
  const erc7930 = encodeErc7930Address(chainId, registryAddress);
  return `agent-registration[0x${erc7930}][${agentId}]`;
}
function parseEnsip25Key(key) {
  const match = key.match(
    /^agent-registration\[(?:0x)?([a-f0-9]+)\]\[([^\[\]]+)\]$/i
  );
  if (!match) return null;
  const decoded = decodeErc7930Address(match[1]);
  if (!decoded) return null;
  return {
    chainId: decoded.chainId,
    registryAddress: decoded.address,
    agentId: match[2]
  };
}
var KNOWN_REGISTRIES = {
  /** ERC-8004 on Base mainnet */
  "8004-base": {
    chainId: 8453,
    address: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"
  },
  /** ERC-8004 on Ethereum mainnet */
  "8004-ethereum": {
    chainId: 1,
    address: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"
  },
  /** AgentBook on Base mainnet */
  "agentbook-base": {
    chainId: 8453,
    address: "0xE1D1D3526A6FAa37eb36bD10B933C1b77f4561a4"
  },
  /** AgentBook on World Chain */
  "agentbook-world": {
    chainId: 480,
    address: "0xA23aB2712eA7BBa896930544C7d6636a96b944dA"
  }
};
function hexToBytes(hex) {
  if (hex.length % 2 !== 0) return null;
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return bytes;
}

// src/layers/identity.ts
var ERC_8004_ABI = [
  {
    name: "tokenURI",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "string" }]
  },
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }]
  }
];
var DEFAULT_REGISTRIES = [
  { chainId: KNOWN_REGISTRIES["8004-base"].chainId, address: KNOWN_REGISTRIES["8004-base"].address },
  { chainId: KNOWN_REGISTRIES["8004-ethereum"].chainId, address: KNOWN_REGISTRIES["8004-ethereum"].address }
];
var CHAIN_MAP = {
  8453: base2
};
async function resolveIdentity(ensName, knownAgentIds, options = {}) {
  const registries = options.registries ?? DEFAULT_REGISTRIES;
  const ensClient = createEnsClient(options.ensRpcUrl);
  for (const registry of registries) {
    const agentIds = knownAgentIds ?? [];
    for (const agentId of agentIds) {
      const key = buildEnsip25Key(registry.chainId, registry.address, agentId);
      const value = await getTextRecord(ensClient, ensName, key);
      if (value && value.length > 0) {
        const onChain = await verifyOnChain(registry, agentId);
        const erc7930 = encodeErc7930Address(registry.chainId, registry.address);
        return {
          verified: true,
          registryAddress: erc7930,
          agentId,
          registryChain: `eip155:${registry.chainId}`,
          tokenURI: onChain.tokenURI,
          owner: onChain.owner
        };
      }
    }
  }
  return {
    verified: false,
    registryAddress: null,
    agentId: null,
    registryChain: null,
    tokenURI: null,
    owner: null
  };
}
async function verifyOnChain(registry, agentId) {
  try {
    const chain = CHAIN_MAP[registry.chainId];
    const client = createPublicClient3({
      chain,
      transport: http3(registry.rpcUrl)
    });
    const [tokenURI, owner] = await Promise.all([
      client.readContract({
        address: registry.address,
        abi: ERC_8004_ABI,
        functionName: "tokenURI",
        args: [BigInt(agentId)]
      }).catch(() => null),
      client.readContract({
        address: registry.address,
        abi: ERC_8004_ABI,
        functionName: "ownerOf",
        args: [BigInt(agentId)]
      }).catch(() => null)
    ]);
    return {
      tokenURI,
      owner
    };
  } catch {
    return { tokenURI: null, owner: null };
  }
}

// src/layers/context.ts
var AGENT_CONTEXT_KEY = "agent-context";
var SKILL_URL_KEYS = ["skill", "skillUrl", "skill_url", "skills"];
async function resolveContext(ensName, options = {}) {
  const client = createEnsClient(options.ensRpcUrl);
  const raw = await getTextRecord(client, ensName, AGENT_CONTEXT_KEY);
  if (!raw) {
    return { found: false, raw: null, parsed: null, skillUrl: null };
  }
  let parsed = null;
  try {
    const obj = JSON.parse(raw);
    if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
      parsed = obj;
    }
  } catch {
  }
  const skillUrl = extractSkillUrl(raw, parsed);
  return { found: true, raw, parsed, skillUrl };
}
function extractSkillUrl(raw, parsed) {
  if (parsed) {
    for (const key of SKILL_URL_KEYS) {
      const value = parsed[key];
      if (typeof value === "string" && looksLikeUrl(value)) {
        return value;
      }
    }
  }
  if (looksLikeUrl(raw) && raw.toLowerCase().includes("skill")) {
    return raw;
  }
  const urlMatch = raw.match(/https?:\/\/[^\s]+skill[^\s]*/i);
  if (urlMatch) {
    return urlMatch[0].replace(/[.,;)]+$/, "");
  }
  return null;
}
function looksLikeUrl(value) {
  return /^https?:\/\//.test(value) || value.startsWith("ipfs://");
}

// src/layers/manifest.ts
import { verifyMessage } from "viem";

// src/schema.ts
import { z } from "zod";
var TrustTier = z.enum([
  "none",
  "registered",
  "discoverable",
  "verified",
  "full"
]);
var AgentBookNetwork = z.enum(["base", "world", "base-sepolia"]);
var PersonhoodResultSchema = z.object({
  verified: z.boolean(),
  nullifierHash: z.string().nullable(),
  network: AgentBookNetwork.nullable(),
  agentBookAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).nullable()
});
var IdentityResultSchema = z.object({
  verified: z.boolean(),
  registryAddress: z.string().nullable(),
  agentId: z.string().nullable(),
  registryChain: z.string().nullable(),
  tokenURI: z.string().nullable(),
  owner: z.string().nullable()
});
var ContextResultSchema = z.object({
  found: z.boolean(),
  raw: z.string().nullable(),
  parsed: z.record(z.unknown()).nullable(),
  skillUrl: z.string().nullable()
});
var AgentManifestSignatureSchema = z.object({
  scheme: z.string(),
  value: z.string()
});
var AgentManifestSchema = z.object({
  schema: z.string(),
  ensName: z.string(),
  version: z.string(),
  prev: z.string().nullable(),
  payload: z.record(z.unknown()),
  manifestHash: z.string().optional(),
  signature: AgentManifestSignatureSchema
});
var ManifestResultSchema = z.object({
  found: z.boolean(),
  latestVersion: z.string().nullable(),
  lineageMode: z.string().nullable(),
  manifest: AgentManifestSchema.nullable(),
  signatureValid: z.boolean(),
  lineageDepth: z.number(),
  lineageIntact: z.boolean()
});
var SkillResultSchema = z.object({
  found: z.boolean(),
  domainVerified: z.boolean(),
  content: z.string().nullable(),
  url: z.string().nullable()
});
var TrustProfileSchema = z.object({
  ensName: z.string(),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).nullable(),
  resolvedAt: z.number(),
  trustScore: TrustTier,
  // Resolution Layer 0: Personhood (World ID)
  personhood: PersonhoodResultSchema,
  // Resolution Layer 1: Identity (ENSIP-25)
  identity: IdentityResultSchema,
  // Resolution Layer 2: Discovery (ENSIP-26)
  context: ContextResultSchema,
  // Resolution Layer 3: Integrity (AIP)
  manifest: ManifestResultSchema,
  // Resolution Layer 4: Capability (DVS)
  skill: SkillResultSchema
});

// src/utils/ipfs.ts
var PUBLIC_GATEWAYS = [
  "https://w3s.link/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://ipfs.io/ipfs/"
];
function extractCid(uri) {
  const ipfsMatch = uri.match(/^ipfs:\/\/(.+)$/);
  if (ipfsMatch) return ipfsMatch[1];
  const gatewayMatch = uri.match(/\/ipfs\/([a-zA-Z0-9]+)/);
  if (gatewayMatch) return gatewayMatch[1];
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58})$/.test(uri)) return uri;
  return null;
}
async function fetchFromIpfs(cid, options) {
  const timeout = options?.timeout ?? 1e4;
  for (const gateway of PUBLIC_GATEWAYS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const response = await fetch(`${gateway}${cid}`, {
        signal: controller.signal
      });
      clearTimeout(timer);
      if (response.ok) {
        return await response.text();
      }
    } catch {
      continue;
    }
  }
  return null;
}
async function fetchJsonFromIpfs(cid, options) {
  const content = await fetchFromIpfs(cid, options);
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}
function cidToUri(cid) {
  return `ipfs://${cid}`;
}
function cidToGatewayUrl(cid, gateway) {
  return `${gateway ?? PUBLIC_GATEWAYS[0]}${cid}`;
}

// src/layers/manifest.ts
async function resolveManifest(ensName, options = {}) {
  const client = createEnsClient(options.ensRpcUrl);
  const maxDepth = options.maxLineageDepth ?? 10;
  const [latestVersion, lineageMode] = await Promise.all([
    getTextRecord(client, ensName, "agent-latest"),
    getTextRecord(client, ensName, "agent-version-lineage")
  ]);
  if (!latestVersion) {
    return emptyResult();
  }
  let manifestRef = null;
  if (!lineageMode || lineageMode === "subname") {
    const versionName = `${latestVersion}.${ensName}`;
    manifestRef = await getTextRecord(client, versionName, "agent-manifest");
  } else if (lineageMode.startsWith("list:")) {
    manifestRef = parseListEntry(lineageMode, latestVersion);
  }
  if (!manifestRef) {
    return {
      ...emptyResult(),
      latestVersion,
      lineageMode: lineageMode ?? "subname"
    };
  }
  const manifest = await fetchManifest(manifestRef);
  if (!manifest) {
    return {
      ...emptyResult(),
      latestVersion,
      lineageMode: lineageMode ?? "subname"
    };
  }
  const signatureValid = await verifyManifestSignature(
    client,
    ensName,
    latestVersion,
    manifest
  );
  const { depth, intact } = await walkLineage(manifest, maxDepth);
  return {
    found: true,
    latestVersion,
    lineageMode: lineageMode ?? "subname",
    manifest,
    signatureValid,
    lineageDepth: depth,
    lineageIntact: intact
  };
}
async function fetchManifest(manifestRef) {
  const cid = extractCid(manifestRef);
  if (!cid) return null;
  const content = await fetchFromIpfs(cid);
  if (!content) return null;
  try {
    const parsed = JSON.parse(content);
    const result = AgentManifestSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
async function verifyManifestSignature(client, ensName, expectedVersion, manifest) {
  if (manifest.ensName !== ensName) return false;
  if (manifest.version !== expectedVersion) return false;
  const ownerAddress = await getOwner(client, ensName);
  if (!ownerAddress) return false;
  const { signature, manifestHash, ...manifestBody } = manifest;
  const canonicalBytes = JSON.stringify(manifestBody, Object.keys(manifestBody).sort());
  try {
    const isValid = await verifyMessage({
      address: ownerAddress,
      message: canonicalBytes,
      signature: signature.value
    });
    return isValid;
  } catch {
    return false;
  }
}
async function walkLineage(manifest, maxDepth) {
  let depth = 0;
  let current = manifest.prev;
  while (current && depth < maxDepth) {
    const cid = extractCid(current);
    if (!cid) return { depth, intact: false };
    const content = await fetchFromIpfs(cid);
    if (!content) return { depth, intact: false };
    try {
      const parsed = JSON.parse(content);
      const result = AgentManifestSchema.safeParse(parsed);
      if (!result.success) return { depth, intact: false };
      depth++;
      current = result.data.prev;
    } catch {
      return { depth, intact: false };
    }
  }
  return { depth, intact: current === null };
}
function parseListEntry(listValue, version) {
  const lines = listValue.replace(/^list:/, "").split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts[0] === version && parts[1]) {
      return parts[1];
    }
  }
  return null;
}
function emptyResult() {
  return {
    found: false,
    latestVersion: null,
    lineageMode: null,
    manifest: null,
    signatureValid: false,
    lineageDepth: 0,
    lineageIntact: false
  };
}

// src/layers/skill.ts
async function resolveSkill(ensName, skillUrl, options = {}) {
  if (!skillUrl) {
    return { found: false, domainVerified: false, content: null, url: null };
  }
  const content = await fetchSkillContent(skillUrl, options.timeout);
  if (!content) {
    return { found: false, domainVerified: false, content: null, url: skillUrl };
  }
  const domainVerified = verifyDomain(ensName, skillUrl);
  return {
    found: true,
    domainVerified,
    content,
    url: skillUrl
  };
}
async function fetchSkillContent(url, timeout) {
  const cid = extractCid(url);
  if (cid) {
    return fetchFromIpfs(cid, { timeout });
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout ?? 1e4);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (response.ok) {
      return await response.text();
    }
    return null;
  } catch {
    return null;
  }
}
function verifyDomain(ensName, url) {
  if (url.startsWith("ipfs://") || extractCid(url)) {
    return true;
  }
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const normalizedName = ensName.toLowerCase();
    if (hostname === `${normalizedName}.limo`) {
      return true;
    }
    if (hostname === `${normalizedName}.link`) {
      return true;
    }
    if (hostname.startsWith(`${normalizedName}.`)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// src/resolve.ts
async function resolve(ensName, options = {}) {
  const normalized = normalizeName(ensName);
  const client = createEnsClient(options.ensRpcUrl);
  const address = await resolveAddress(client, normalized);
  const personhood = address ? await resolvePersonhood(address, {
    networks: options.personhoodNetworks ? [...options.personhoodNetworks] : void 0
  }) : { verified: false, nullifierHash: null, network: null, agentBookAddress: null };
  const identity = await resolveIdentity(normalized, options.knownAgentIds, {
    ensRpcUrl: options.ensRpcUrl
  });
  const context = await resolveContext(normalized, {
    ensRpcUrl: options.ensRpcUrl
  });
  const manifest = await resolveManifest(normalized, {
    ensRpcUrl: options.ensRpcUrl,
    maxLineageDepth: options.maxLineageDepth
  });
  const skill = await resolveSkill(normalized, context.skillUrl, {
    ensRpcUrl: options.ensRpcUrl
  });
  const trustScore = computeTrustTier(identity, context, manifest, skill);
  return {
    ensName: normalized,
    address,
    resolvedAt: Date.now(),
    trustScore,
    personhood,
    identity,
    context,
    manifest,
    skill
  };
}
function computeTrustTier(identity, context, manifest, skill) {
  if (!identity.verified) return "none";
  if (!context.found) return "registered";
  if (!manifest.found || !manifest.signatureValid) return "discoverable";
  if (!skill.found || !skill.domainVerified || !manifest.lineageIntact)
    return "verified";
  return "full";
}

// src/policy.ts
import { z as z2 } from "zod";
var TrustPolicySchema = z2.object({
  minTier: TrustTier.default("verified"),
  requireLineage: z2.boolean().default(true),
  requireSig: z2.boolean().default(true),
  allowSelf: z2.boolean().default(true)
});
var GateDecisionSchema = z2.object({
  allow: z2.boolean(),
  reason: z2.string(),
  profile: TrustProfileSchema,
  policy: TrustPolicySchema
});
var TIER_RANK = {
  none: 0,
  registered: 1,
  discoverable: 2,
  verified: 3,
  full: 4
};
function tierRank(t) {
  return TIER_RANK[t];
}
function gate(profile, policy, callerEns) {
  const p = TrustPolicySchema.parse(policy);
  if (!p.allowSelf) {
    if (!callerEns) {
      return {
        allow: false,
        reason: "self-resolution check requires callerEns when allowSelf is false",
        profile,
        policy
      };
    }
    const caller = normalizeName(callerEns);
    const target = normalizeName(profile.ensName);
    if (caller === target) {
      return {
        allow: false,
        reason: "self-resolution not permitted by policy",
        profile,
        policy
      };
    }
  }
  if (tierRank(profile.trustScore) < tierRank(p.minTier)) {
    return {
      allow: false,
      reason: `tier ${profile.trustScore} below required ${p.minTier}`,
      profile,
      policy
    };
  }
  if (p.requireSig && profile.manifest.found && !profile.manifest.signatureValid) {
    return {
      allow: false,
      reason: "manifest signature does not match current ENS owner",
      profile,
      policy
    };
  }
  if (p.requireLineage && !profile.manifest.lineageIntact) {
    return {
      allow: false,
      reason: `manifest lineage broken at v${profile.manifest.lineageDepth}`,
      profile,
      policy
    };
  }
  return {
    allow: true,
    reason: `all gates passed at tier ${profile.trustScore}`,
    profile,
    policy
  };
}

// src/wallets/local.ts
import { createWalletClient, http as http4 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
function createLocalSigner(opts) {
  const account = privateKeyToAccount(opts.privateKey);
  const walletClient = createWalletClient({
    account,
    chain: opts.chain,
    transport: http4(opts.rpc)
  });
  return {
    address: account.address,
    async execute(batches) {
      for (const batch of batches) {
        if (batch.chainId !== opts.chain.id) {
          throw new Error(
            `[createLocalSigner] batch.chainId ${batch.chainId} does not match signer chain ${opts.chain.id} (${opts.chain.name}). Local signers are locked to a single chain at construction; reuse Batch builders only when chainId matches.`
          );
        }
      }
      const wantsAtomic = batches.some(
        (b) => b.atomic && b.calls.length > 1
      );
      if (wantsAtomic) {
        console.warn(
          "[createLocalSigner] atomic batch requested but EOAs cannot batch atomically; sending calls sequentially. Use createNameraSigner for atomic batches."
        );
      }
      let lastHash;
      for (const batch of batches) {
        for (const call of batch.calls) {
          lastHash = await walletClient.sendTransaction({
            to: call.to,
            data: call.data,
            value: call.value,
            chain: opts.chain
          });
        }
      }
      if (!lastHash) {
        throw new Error(
          "[createLocalSigner] execute() called with no calls to submit"
        );
      }
      return lastHash;
    }
  };
}

// src/wallets/namera.ts
import { createSessionKeyClient } from "@namera-ai/sdk/session-key";
import { executeTransaction } from "@namera-ai/sdk/transaction";
import {
  createPublicClient as createPublicClient4,
  http as http5
} from "viem";
import { privateKeyToAccount as privateKeyToAccount2 } from "viem/accounts";
async function createNameraSigner(opts) {
  const serializedAccount = (await opts.readSessionKey()).trim();
  const client = createPublicClient4({
    chain: opts.chain,
    transport: http5(opts.rpc)
  });
  const signer = privateKeyToAccount2(opts.sessionKeyPrivateKey);
  const sessionKeyClient = await createSessionKeyClient({
    type: "ecdsa",
    signer,
    client,
    serializedAccount,
    bundlerTransport: http5(opts.bundlerUrl),
    chain: opts.chain,
    entrypointVersion: opts.entrypointVersion ?? "0.7",
    kernelVersion: opts.kernelVersion
    // biome-ignore lint/suspicious/noExplicitAny: heavy generic narrowing —
    // namera's createSessionKeyClient requires param-tuple inference that
    // doesn't survive our thinner wrapper signature.
  });
  return {
    address: sessionKeyClient.account.address,
    async execute(batches) {
      const receipts = await executeTransaction({
        batches,
        clients: [sessionKeyClient]
      });
      for (let i = receipts.length - 1; i >= 0; i--) {
        const receipt = receipts[i];
        if (receipt) {
          return receipt.receipt.transactionHash;
        }
      }
      throw new Error(
        "[createNameraSigner] all batches failed to broadcast"
      );
    }
  };
}
export {
  AgentBookNetwork,
  AgentManifestSchema,
  AgentManifestSignatureSchema,
  ContextResultSchema,
  GateDecisionSchema,
  IdentityResultSchema,
  KNOWN_REGISTRIES,
  ManifestResultSchema,
  PersonhoodResultSchema,
  SkillResultSchema,
  TrustPolicySchema,
  TrustProfileSchema,
  TrustTier,
  buildEnsip25Key,
  cidToGatewayUrl,
  cidToUri,
  createEnsClient,
  createLocalSigner,
  createNameraSigner,
  decodeErc7930Address,
  encodeErc7930Address,
  extractCid,
  fetchFromIpfs,
  fetchJsonFromIpfs,
  gate,
  getOwner,
  getTextRecord,
  getTextRecords,
  normalizeName,
  parseEnsip25Key,
  resolve,
  resolveAddress,
  resolveContext,
  resolveIdentity,
  resolveManifest,
  resolvePersonhood,
  resolveSkill
};
