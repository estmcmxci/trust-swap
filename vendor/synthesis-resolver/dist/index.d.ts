import { z } from 'zod';
import { Address, PublicClient, Hex, Chain, EntryPointVersion } from 'viem';

declare const TrustTier: z.ZodEnum<["none", "registered", "discoverable", "verified", "full"]>;
type TrustTier = z.infer<typeof TrustTier>;
declare const AgentBookNetwork: z.ZodEnum<["base", "world", "base-sepolia"]>;
type AgentBookNetwork = z.infer<typeof AgentBookNetwork>;
declare const PersonhoodResultSchema: z.ZodObject<{
    verified: z.ZodBoolean;
    nullifierHash: z.ZodNullable<z.ZodString>;
    network: z.ZodNullable<z.ZodEnum<["base", "world", "base-sepolia"]>>;
    agentBookAddress: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    verified: boolean;
    nullifierHash: string | null;
    network: "base" | "world" | "base-sepolia" | null;
    agentBookAddress: string | null;
}, {
    verified: boolean;
    nullifierHash: string | null;
    network: "base" | "world" | "base-sepolia" | null;
    agentBookAddress: string | null;
}>;
type PersonhoodResult = z.infer<typeof PersonhoodResultSchema>;
declare const IdentityResultSchema: z.ZodObject<{
    verified: z.ZodBoolean;
    registryAddress: z.ZodNullable<z.ZodString>;
    agentId: z.ZodNullable<z.ZodString>;
    registryChain: z.ZodNullable<z.ZodString>;
    tokenURI: z.ZodNullable<z.ZodString>;
    owner: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    verified: boolean;
    registryAddress: string | null;
    agentId: string | null;
    registryChain: string | null;
    tokenURI: string | null;
    owner: string | null;
}, {
    verified: boolean;
    registryAddress: string | null;
    agentId: string | null;
    registryChain: string | null;
    tokenURI: string | null;
    owner: string | null;
}>;
type IdentityResult = z.infer<typeof IdentityResultSchema>;
declare const ContextResultSchema: z.ZodObject<{
    found: z.ZodBoolean;
    raw: z.ZodNullable<z.ZodString>;
    parsed: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    skillUrl: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    found: boolean;
    raw: string | null;
    parsed: Record<string, unknown> | null;
    skillUrl: string | null;
}, {
    found: boolean;
    raw: string | null;
    parsed: Record<string, unknown> | null;
    skillUrl: string | null;
}>;
type ContextResult = z.infer<typeof ContextResultSchema>;
declare const AgentManifestSignatureSchema: z.ZodObject<{
    scheme: z.ZodString;
    value: z.ZodString;
}, "strip", z.ZodTypeAny, {
    value: string;
    scheme: string;
}, {
    value: string;
    scheme: string;
}>;
declare const AgentManifestSchema: z.ZodObject<{
    schema: z.ZodString;
    ensName: z.ZodString;
    version: z.ZodString;
    prev: z.ZodNullable<z.ZodString>;
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    manifestHash: z.ZodOptional<z.ZodString>;
    signature: z.ZodObject<{
        scheme: z.ZodString;
        value: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        value: string;
        scheme: string;
    }, {
        value: string;
        scheme: string;
    }>;
}, "strip", z.ZodTypeAny, {
    schema: string;
    ensName: string;
    version: string;
    prev: string | null;
    payload: Record<string, unknown>;
    signature: {
        value: string;
        scheme: string;
    };
    manifestHash?: string | undefined;
}, {
    schema: string;
    ensName: string;
    version: string;
    prev: string | null;
    payload: Record<string, unknown>;
    signature: {
        value: string;
        scheme: string;
    };
    manifestHash?: string | undefined;
}>;
type AgentManifest = z.infer<typeof AgentManifestSchema>;
declare const ManifestResultSchema: z.ZodObject<{
    found: z.ZodBoolean;
    latestVersion: z.ZodNullable<z.ZodString>;
    lineageMode: z.ZodNullable<z.ZodString>;
    manifest: z.ZodNullable<z.ZodObject<{
        schema: z.ZodString;
        ensName: z.ZodString;
        version: z.ZodString;
        prev: z.ZodNullable<z.ZodString>;
        payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        manifestHash: z.ZodOptional<z.ZodString>;
        signature: z.ZodObject<{
            scheme: z.ZodString;
            value: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            value: string;
            scheme: string;
        }, {
            value: string;
            scheme: string;
        }>;
    }, "strip", z.ZodTypeAny, {
        schema: string;
        ensName: string;
        version: string;
        prev: string | null;
        payload: Record<string, unknown>;
        signature: {
            value: string;
            scheme: string;
        };
        manifestHash?: string | undefined;
    }, {
        schema: string;
        ensName: string;
        version: string;
        prev: string | null;
        payload: Record<string, unknown>;
        signature: {
            value: string;
            scheme: string;
        };
        manifestHash?: string | undefined;
    }>>;
    signatureValid: z.ZodBoolean;
    lineageDepth: z.ZodNumber;
    lineageIntact: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    found: boolean;
    latestVersion: string | null;
    lineageMode: string | null;
    manifest: {
        schema: string;
        ensName: string;
        version: string;
        prev: string | null;
        payload: Record<string, unknown>;
        signature: {
            value: string;
            scheme: string;
        };
        manifestHash?: string | undefined;
    } | null;
    signatureValid: boolean;
    lineageDepth: number;
    lineageIntact: boolean;
}, {
    found: boolean;
    latestVersion: string | null;
    lineageMode: string | null;
    manifest: {
        schema: string;
        ensName: string;
        version: string;
        prev: string | null;
        payload: Record<string, unknown>;
        signature: {
            value: string;
            scheme: string;
        };
        manifestHash?: string | undefined;
    } | null;
    signatureValid: boolean;
    lineageDepth: number;
    lineageIntact: boolean;
}>;
type ManifestResult = z.infer<typeof ManifestResultSchema>;
declare const SkillResultSchema: z.ZodObject<{
    found: z.ZodBoolean;
    domainVerified: z.ZodBoolean;
    content: z.ZodNullable<z.ZodString>;
    url: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    found: boolean;
    domainVerified: boolean;
    content: string | null;
    url: string | null;
}, {
    found: boolean;
    domainVerified: boolean;
    content: string | null;
    url: string | null;
}>;
type SkillResult = z.infer<typeof SkillResultSchema>;
declare const TrustProfileSchema: z.ZodObject<{
    ensName: z.ZodString;
    address: z.ZodNullable<z.ZodString>;
    resolvedAt: z.ZodNumber;
    trustScore: z.ZodEnum<["none", "registered", "discoverable", "verified", "full"]>;
    personhood: z.ZodObject<{
        verified: z.ZodBoolean;
        nullifierHash: z.ZodNullable<z.ZodString>;
        network: z.ZodNullable<z.ZodEnum<["base", "world", "base-sepolia"]>>;
        agentBookAddress: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        verified: boolean;
        nullifierHash: string | null;
        network: "base" | "world" | "base-sepolia" | null;
        agentBookAddress: string | null;
    }, {
        verified: boolean;
        nullifierHash: string | null;
        network: "base" | "world" | "base-sepolia" | null;
        agentBookAddress: string | null;
    }>;
    identity: z.ZodObject<{
        verified: z.ZodBoolean;
        registryAddress: z.ZodNullable<z.ZodString>;
        agentId: z.ZodNullable<z.ZodString>;
        registryChain: z.ZodNullable<z.ZodString>;
        tokenURI: z.ZodNullable<z.ZodString>;
        owner: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        verified: boolean;
        registryAddress: string | null;
        agentId: string | null;
        registryChain: string | null;
        tokenURI: string | null;
        owner: string | null;
    }, {
        verified: boolean;
        registryAddress: string | null;
        agentId: string | null;
        registryChain: string | null;
        tokenURI: string | null;
        owner: string | null;
    }>;
    context: z.ZodObject<{
        found: z.ZodBoolean;
        raw: z.ZodNullable<z.ZodString>;
        parsed: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        skillUrl: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        found: boolean;
        raw: string | null;
        parsed: Record<string, unknown> | null;
        skillUrl: string | null;
    }, {
        found: boolean;
        raw: string | null;
        parsed: Record<string, unknown> | null;
        skillUrl: string | null;
    }>;
    manifest: z.ZodObject<{
        found: z.ZodBoolean;
        latestVersion: z.ZodNullable<z.ZodString>;
        lineageMode: z.ZodNullable<z.ZodString>;
        manifest: z.ZodNullable<z.ZodObject<{
            schema: z.ZodString;
            ensName: z.ZodString;
            version: z.ZodString;
            prev: z.ZodNullable<z.ZodString>;
            payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
            manifestHash: z.ZodOptional<z.ZodString>;
            signature: z.ZodObject<{
                scheme: z.ZodString;
                value: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                value: string;
                scheme: string;
            }, {
                value: string;
                scheme: string;
            }>;
        }, "strip", z.ZodTypeAny, {
            schema: string;
            ensName: string;
            version: string;
            prev: string | null;
            payload: Record<string, unknown>;
            signature: {
                value: string;
                scheme: string;
            };
            manifestHash?: string | undefined;
        }, {
            schema: string;
            ensName: string;
            version: string;
            prev: string | null;
            payload: Record<string, unknown>;
            signature: {
                value: string;
                scheme: string;
            };
            manifestHash?: string | undefined;
        }>>;
        signatureValid: z.ZodBoolean;
        lineageDepth: z.ZodNumber;
        lineageIntact: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        found: boolean;
        latestVersion: string | null;
        lineageMode: string | null;
        manifest: {
            schema: string;
            ensName: string;
            version: string;
            prev: string | null;
            payload: Record<string, unknown>;
            signature: {
                value: string;
                scheme: string;
            };
            manifestHash?: string | undefined;
        } | null;
        signatureValid: boolean;
        lineageDepth: number;
        lineageIntact: boolean;
    }, {
        found: boolean;
        latestVersion: string | null;
        lineageMode: string | null;
        manifest: {
            schema: string;
            ensName: string;
            version: string;
            prev: string | null;
            payload: Record<string, unknown>;
            signature: {
                value: string;
                scheme: string;
            };
            manifestHash?: string | undefined;
        } | null;
        signatureValid: boolean;
        lineageDepth: number;
        lineageIntact: boolean;
    }>;
    skill: z.ZodObject<{
        found: z.ZodBoolean;
        domainVerified: z.ZodBoolean;
        content: z.ZodNullable<z.ZodString>;
        url: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        found: boolean;
        domainVerified: boolean;
        content: string | null;
        url: string | null;
    }, {
        found: boolean;
        domainVerified: boolean;
        content: string | null;
        url: string | null;
    }>;
}, "strip", z.ZodTypeAny, {
    ensName: string;
    manifest: {
        found: boolean;
        latestVersion: string | null;
        lineageMode: string | null;
        manifest: {
            schema: string;
            ensName: string;
            version: string;
            prev: string | null;
            payload: Record<string, unknown>;
            signature: {
                value: string;
                scheme: string;
            };
            manifestHash?: string | undefined;
        } | null;
        signatureValid: boolean;
        lineageDepth: number;
        lineageIntact: boolean;
    };
    address: string | null;
    resolvedAt: number;
    trustScore: "none" | "registered" | "discoverable" | "verified" | "full";
    personhood: {
        verified: boolean;
        nullifierHash: string | null;
        network: "base" | "world" | "base-sepolia" | null;
        agentBookAddress: string | null;
    };
    identity: {
        verified: boolean;
        registryAddress: string | null;
        agentId: string | null;
        registryChain: string | null;
        tokenURI: string | null;
        owner: string | null;
    };
    context: {
        found: boolean;
        raw: string | null;
        parsed: Record<string, unknown> | null;
        skillUrl: string | null;
    };
    skill: {
        found: boolean;
        domainVerified: boolean;
        content: string | null;
        url: string | null;
    };
}, {
    ensName: string;
    manifest: {
        found: boolean;
        latestVersion: string | null;
        lineageMode: string | null;
        manifest: {
            schema: string;
            ensName: string;
            version: string;
            prev: string | null;
            payload: Record<string, unknown>;
            signature: {
                value: string;
                scheme: string;
            };
            manifestHash?: string | undefined;
        } | null;
        signatureValid: boolean;
        lineageDepth: number;
        lineageIntact: boolean;
    };
    address: string | null;
    resolvedAt: number;
    trustScore: "none" | "registered" | "discoverable" | "verified" | "full";
    personhood: {
        verified: boolean;
        nullifierHash: string | null;
        network: "base" | "world" | "base-sepolia" | null;
        agentBookAddress: string | null;
    };
    identity: {
        verified: boolean;
        registryAddress: string | null;
        agentId: string | null;
        registryChain: string | null;
        tokenURI: string | null;
        owner: string | null;
    };
    context: {
        found: boolean;
        raw: string | null;
        parsed: Record<string, unknown> | null;
        skillUrl: string | null;
    };
    skill: {
        found: boolean;
        domainVerified: boolean;
        content: string | null;
        url: string | null;
    };
}>;
type TrustProfile = z.infer<typeof TrustProfileSchema>;

/**
 * Trust Resolution Layer — Main Resolver
 *
 * Composes all 5 resolution layers into a single TrustProfile.
 * This is the main export of @synthesis/resolver.
 *
 * Usage:
 *   import { resolve } from '@synthesis/resolver'
 *   const profile = await resolve('emilemarcelagustin.eth')
 */

interface ResolveOptions {
    /** Known agent IDs to scan for ENSIP-25 records */
    knownAgentIds?: string[];
    /** Custom RPC URL for ENS resolution (mainnet) */
    ensRpcUrl?: string;
    /** Networks to check for AgentBook personhood */
    personhoodNetworks?: ("base" | "world" | "base-sepolia")[];
    /** Maximum lineage depth for AIP prev chain traversal */
    maxLineageDepth?: number;
}
/**
 * Resolve an ENS name through all 5 trust layers.
 *
 * Returns a complete TrustProfile with per-layer results and
 * an aggregate trust score.
 */
declare function resolve(ensName: string, options?: ResolveOptions): Promise<TrustProfile>;

interface ResolvePersonhoodOptions {
    networks?: AgentBookNetwork[];
    rpcUrl?: string;
}
/**
 * Resolve proof-of-personhood for an address by querying AgentBook contracts.
 *
 * Checks each network in order and returns on the first match.
 * Returns { verified: false } if not registered on any network.
 */
declare function resolvePersonhood(address: Address, options?: ResolvePersonhoodOptions): Promise<PersonhoodResult>;

/**
 * Resolution Layer 1: Identity (ENSIP-25)
 *
 * Scans known ERC-8004 registries for ENSIP-25 agent-registration
 * text records on an ENS name. If found, verifies the agent exists
 * on-chain via tokenURI + ownerOf.
 *
 * Read-only: never writes records.
 */

/** Registry to scan: chainId + contract address + RPC */
interface RegistryTarget {
    chainId: number;
    address: string;
    rpcUrl?: string;
}
interface ResolveIdentityOptions {
    registries?: RegistryTarget[];
    ensRpcUrl?: string;
}
/**
 * Resolve ENSIP-25 identity for an ENS name.
 *
 * For each known registry, constructs all possible ENSIP-25 keys
 * (scanning agent IDs from text records), checks if the record is set,
 * and verifies the agent on-chain.
 *
 * Since we don't know the agent ID upfront, we scan by checking known
 * agent IDs from the ENS name's text records. The approach:
 * 1. For each registry, build the ERC-7930 prefix
 * 2. Try to find an agent-registration text record by scanning known IDs
 *    or by using a wildcard approach
 *
 * In practice, the resolver is given a name and must discover the agent ID.
 * We do this by scanning text record keys that match the ENSIP-25 pattern.
 * Since viem can't enumerate text records, we try known agent IDs if provided,
 * or fall back to scanning a reasonable range.
 */
declare function resolveIdentity(ensName: string, knownAgentIds?: string[], options?: ResolveIdentityOptions): Promise<IdentityResult>;

/**
 * Resolution Layer 2: Discovery (ENSIP-26)
 *
 * Reads the `agent-context` text record from an ENS name.
 * Parses as JSON if structured. Extracts SKILL.md URL if present.
 *
 * Read-only: never writes records.
 */

interface ResolveContextOptions {
    ensRpcUrl?: string;
}
/**
 * Resolve ENSIP-26 agent-context for an ENS name.
 *
 * Reads the `agent-context` text record, attempts JSON parsing,
 * and extracts a SKILL.md URL if present.
 */
declare function resolveContext(ensName: string, options?: ResolveContextOptions): Promise<ContextResult>;

/**
 * Resolution Layer 3: Integrity (AIP — Agent Identity Profile)
 *
 * Implements the AIP V2 spec (Mode A — subname-per-version):
 * 1. Read agent-latest + agent-version-lineage from root name
 * 2. Resolve agent-manifest from version subname (e.g., v1.<root>)
 * 3. Fetch manifest from IPFS
 * 4. Verify signature against ENS owner
 * 5. Walk prev chain for lineage audit
 *
 * Read-only: never writes records.
 */

interface ResolveManifestOptions {
    ensRpcUrl?: string;
    maxLineageDepth?: number;
}
/**
 * Resolve AIP manifest for an ENS name.
 *
 * Follows the AIP V2 client behavior (Section 3):
 * 1. Read agent-latest and agent-version-lineage from root
 * 2. Resolve manifestRef based on lineage mode
 * 3. Fetch + parse manifest
 * 4. Verify ensName, version, and signature
 * 5. Walk prev pointers for lineage audit
 */
declare function resolveManifest(ensName: string, options?: ResolveManifestOptions): Promise<ManifestResult>;

/**
 * Resolution Layer 4: Capability (DVS — Domain-Verified SKILL.md)
 *
 * Fetches SKILL.md from the URL extracted by the context layer (Layer 2).
 * Verifies that the serving domain is owned by the same ENS name.
 *
 * Domain verification: if the SKILL.md is served from `<name>.eth.limo`
 * or a domain whose ENS reverse record matches the root name, it's verified.
 *
 * Read-only: never writes.
 */

interface ResolveSkillOptions {
    ensRpcUrl?: string;
    timeout?: number;
}
/**
 * Resolve SKILL.md for an ENS name given a skill URL from the context layer.
 *
 * If skillUrl is null (no URL found in agent-context), returns not found.
 */
declare function resolveSkill(ensName: string, skillUrl: string | null, options?: ResolveSkillOptions): Promise<SkillResult>;

/**
 * ENS Utilities — name normalization and text record reading.
 *
 * Uses viem's built-in ENS support: normalize(), getEnsText(),
 * getEnsAddress(). Supports CCIP-Read (ERC-3668) for offchain names.
 */

/**
 * Create a public client configured for ENS resolution on mainnet.
 *
 * Priority: explicit rpcUrl > ETH_RPC_URL env var > default (eth.drpc.org)
 */
declare function createEnsClient(rpcUrl?: string): PublicClient;
/**
 * Normalize an ENS name per ENSIP-1.
 *
 * Handles Unicode normalization, label validation, and dot separation.
 * Throws if the name is invalid.
 */
declare function normalizeName(name: string): string;
/**
 * Read a single text record from an ENS name.
 *
 * Supports CCIP-Read (ERC-3668) for offchain resolvers.
 * Returns null if the record is not set or the name doesn't exist.
 */
declare function getTextRecord(client: PublicClient, name: string, key: string): Promise<string | null>;
/**
 * Read multiple text records from an ENS name in parallel.
 *
 * Returns a record of key → value, omitting keys with no value set.
 */
declare function getTextRecords(client: PublicClient, name: string, keys: string[]): Promise<Record<string, string>>;
/**
 * Resolve an ENS name to an Ethereum address.
 *
 * Returns null if the name doesn't resolve.
 */
declare function resolveAddress(client: PublicClient, name: string): Promise<Address | null>;
/**
 * Get the registry owner of an ENS name — the address that controls the
 * name and is authorized to sign records on its behalf.
 *
 * Resolution chain:
 * 1. `Registry.owner(node)` → registry owner.
 * 2. If owner is the NameWrapper, unwrap via `NameWrapper.ownerOf(uint256(node))`.
 * 3. If owner is the BaseRegistrar (unwrapped `.eth` 2LDs), look up the true
 *    controller via `BaseRegistrar.ownerOf(uint256(labelhash(label)))` —
 *    the registry owner for these names is the registrar contract itself,
 *    not the user.
 * 4. Otherwise, return the registry owner.
 *
 * This is the right address for verifying record signatures (AIP manifests,
 * ENSIP-25 links, etc.) — distinct from `addr()`, which is the payment
 * address and may be a smart contract that does not control the name.
 *
 * Returns null if the name is unowned or the lookup fails.
 */
declare function getOwner(client: PublicClient, name: string): Promise<Address | null>;

/**
 * IPFS Utilities — gateway fetch for content-addressed data.
 *
 * Read-only: the resolver never writes to IPFS.
 * Pinning is handled by CLI commands (OmniPin for sites, Pinata for individual files).
 */
/**
 * Extract a CID from various IPFS URI formats.
 *
 * Handles: `ipfs://Qm...`, `ipfs://baf...`, `Qm...`, `baf...`,
 * and gateway URLs like `https://gateway.pinata.cloud/ipfs/Qm...`
 */
declare function extractCid(uri: string): string | null;
/**
 * Fetch content from IPFS by CID, trying multiple public gateways.
 *
 * Returns the response body as a string, or null if all gateways fail.
 */
declare function fetchFromIpfs(cid: string, options?: {
    timeout?: number;
}): Promise<string | null>;
/**
 * Fetch and parse JSON from IPFS by CID.
 *
 * Returns the parsed object, or null if fetch fails or content isn't valid JSON.
 */
declare function fetchJsonFromIpfs<T = unknown>(cid: string, options?: {
    timeout?: number;
}): Promise<T | null>;
/**
 * Convert a CID to an ipfs:// URI.
 */
declare function cidToUri(cid: string): string;
/**
 * Convert a CID to a gateway URL.
 */
declare function cidToGatewayUrl(cid: string, gateway?: string): string;

/**
 * ERC-7930 Interoperable Address Encoding/Decoding
 *
 * Encodes chain ID + contract address into ERC-7930 v1 format
 * for constructing ENSIP-25 `agent-registration[registry][agentId]` keys.
 *
 * Format (ERC-7930 v1):
 *   Version (2 bytes)  | ChainType (2 bytes) | ChainRefLen (1 byte) | ChainRef (variable) | AddrLen (1 byte) | Address (variable)
 *   0x0001             | 0x0000 (EVM)        | N                    | chain ID bytes       | 0x14 (20)        | 20 bytes
 *
 * Reference: https://eips.ethereum.org/EIPS/eip-7930
 */
/**
 * Encode a chain ID + address into ERC-7930 v1 format (EVM).
 *
 * Returns the hex string WITHOUT the 0x prefix (for use in ENSIP-25 keys).
 */
declare function encodeErc7930Address(chainId: number, contractAddress: string): string;
/**
 * Decode an ERC-7930 v1 encoded address hex string.
 *
 * Accepts with or without 0x prefix.
 * Returns { chainId, address } or null if the format is invalid.
 */
declare function decodeErc7930Address(encoded: string): {
    chainId: number;
    address: string;
} | null;
/**
 * Build an ENSIP-25 text record key for agent registration.
 *
 * Format per spec: `agent-registration[0x<erc7930>][<agentId>]`
 */
declare function buildEnsip25Key(chainId: number, registryAddress: string, agentId: string): string;
/**
 * Parse an ENSIP-25 text record key back into its components.
 *
 * Returns null if the key doesn't match the expected pattern.
 */
declare function parseEnsip25Key(key: string): {
    chainId: number;
    registryAddress: string;
    agentId: string;
} | null;
/** Well-known registries */
declare const KNOWN_REGISTRIES: {
    /** ERC-8004 on Base mainnet */
    readonly "8004-base": {
        readonly chainId: 8453;
        readonly address: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
    };
    /** ERC-8004 on Ethereum mainnet */
    readonly "8004-ethereum": {
        readonly chainId: 1;
        readonly address: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
    };
    /** AgentBook on Base mainnet */
    readonly "agentbook-base": {
        readonly chainId: 8453;
        readonly address: "0xE1D1D3526A6FAa37eb36bD10B933C1b77f4561a4";
    };
    /** AgentBook on World Chain */
    readonly "agentbook-world": {
        readonly chainId: 480;
        readonly address: "0xA23aB2712eA7BBa896930544C7d6636a96b944dA";
    };
};

declare const TrustPolicySchema: z.ZodObject<{
    minTier: z.ZodDefault<z.ZodEnum<["none", "registered", "discoverable", "verified", "full"]>>;
    requireLineage: z.ZodDefault<z.ZodBoolean>;
    requireSig: z.ZodDefault<z.ZodBoolean>;
    allowSelf: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    minTier: "none" | "registered" | "discoverable" | "verified" | "full";
    requireLineage: boolean;
    requireSig: boolean;
    allowSelf: boolean;
}, {
    minTier?: "none" | "registered" | "discoverable" | "verified" | "full" | undefined;
    requireLineage?: boolean | undefined;
    requireSig?: boolean | undefined;
    allowSelf?: boolean | undefined;
}>;
type TrustPolicy = z.infer<typeof TrustPolicySchema>;
declare const GateDecisionSchema: z.ZodObject<{
    allow: z.ZodBoolean;
    reason: z.ZodString;
    profile: z.ZodObject<{
        ensName: z.ZodString;
        address: z.ZodNullable<z.ZodString>;
        resolvedAt: z.ZodNumber;
        trustScore: z.ZodEnum<["none", "registered", "discoverable", "verified", "full"]>;
        personhood: z.ZodObject<{
            verified: z.ZodBoolean;
            nullifierHash: z.ZodNullable<z.ZodString>;
            network: z.ZodNullable<z.ZodEnum<["base", "world", "base-sepolia"]>>;
            agentBookAddress: z.ZodNullable<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            verified: boolean;
            nullifierHash: string | null;
            network: "base" | "world" | "base-sepolia" | null;
            agentBookAddress: string | null;
        }, {
            verified: boolean;
            nullifierHash: string | null;
            network: "base" | "world" | "base-sepolia" | null;
            agentBookAddress: string | null;
        }>;
        identity: z.ZodObject<{
            verified: z.ZodBoolean;
            registryAddress: z.ZodNullable<z.ZodString>;
            agentId: z.ZodNullable<z.ZodString>;
            registryChain: z.ZodNullable<z.ZodString>;
            tokenURI: z.ZodNullable<z.ZodString>;
            owner: z.ZodNullable<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            verified: boolean;
            registryAddress: string | null;
            agentId: string | null;
            registryChain: string | null;
            tokenURI: string | null;
            owner: string | null;
        }, {
            verified: boolean;
            registryAddress: string | null;
            agentId: string | null;
            registryChain: string | null;
            tokenURI: string | null;
            owner: string | null;
        }>;
        context: z.ZodObject<{
            found: z.ZodBoolean;
            raw: z.ZodNullable<z.ZodString>;
            parsed: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            skillUrl: z.ZodNullable<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            found: boolean;
            raw: string | null;
            parsed: Record<string, unknown> | null;
            skillUrl: string | null;
        }, {
            found: boolean;
            raw: string | null;
            parsed: Record<string, unknown> | null;
            skillUrl: string | null;
        }>;
        manifest: z.ZodObject<{
            found: z.ZodBoolean;
            latestVersion: z.ZodNullable<z.ZodString>;
            lineageMode: z.ZodNullable<z.ZodString>;
            manifest: z.ZodNullable<z.ZodObject<{
                schema: z.ZodString;
                ensName: z.ZodString;
                version: z.ZodString;
                prev: z.ZodNullable<z.ZodString>;
                payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
                manifestHash: z.ZodOptional<z.ZodString>;
                signature: z.ZodObject<{
                    scheme: z.ZodString;
                    value: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    value: string;
                    scheme: string;
                }, {
                    value: string;
                    scheme: string;
                }>;
            }, "strip", z.ZodTypeAny, {
                schema: string;
                ensName: string;
                version: string;
                prev: string | null;
                payload: Record<string, unknown>;
                signature: {
                    value: string;
                    scheme: string;
                };
                manifestHash?: string | undefined;
            }, {
                schema: string;
                ensName: string;
                version: string;
                prev: string | null;
                payload: Record<string, unknown>;
                signature: {
                    value: string;
                    scheme: string;
                };
                manifestHash?: string | undefined;
            }>>;
            signatureValid: z.ZodBoolean;
            lineageDepth: z.ZodNumber;
            lineageIntact: z.ZodBoolean;
        }, "strip", z.ZodTypeAny, {
            found: boolean;
            latestVersion: string | null;
            lineageMode: string | null;
            manifest: {
                schema: string;
                ensName: string;
                version: string;
                prev: string | null;
                payload: Record<string, unknown>;
                signature: {
                    value: string;
                    scheme: string;
                };
                manifestHash?: string | undefined;
            } | null;
            signatureValid: boolean;
            lineageDepth: number;
            lineageIntact: boolean;
        }, {
            found: boolean;
            latestVersion: string | null;
            lineageMode: string | null;
            manifest: {
                schema: string;
                ensName: string;
                version: string;
                prev: string | null;
                payload: Record<string, unknown>;
                signature: {
                    value: string;
                    scheme: string;
                };
                manifestHash?: string | undefined;
            } | null;
            signatureValid: boolean;
            lineageDepth: number;
            lineageIntact: boolean;
        }>;
        skill: z.ZodObject<{
            found: z.ZodBoolean;
            domainVerified: z.ZodBoolean;
            content: z.ZodNullable<z.ZodString>;
            url: z.ZodNullable<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            found: boolean;
            domainVerified: boolean;
            content: string | null;
            url: string | null;
        }, {
            found: boolean;
            domainVerified: boolean;
            content: string | null;
            url: string | null;
        }>;
    }, "strip", z.ZodTypeAny, {
        ensName: string;
        manifest: {
            found: boolean;
            latestVersion: string | null;
            lineageMode: string | null;
            manifest: {
                schema: string;
                ensName: string;
                version: string;
                prev: string | null;
                payload: Record<string, unknown>;
                signature: {
                    value: string;
                    scheme: string;
                };
                manifestHash?: string | undefined;
            } | null;
            signatureValid: boolean;
            lineageDepth: number;
            lineageIntact: boolean;
        };
        address: string | null;
        resolvedAt: number;
        trustScore: "none" | "registered" | "discoverable" | "verified" | "full";
        personhood: {
            verified: boolean;
            nullifierHash: string | null;
            network: "base" | "world" | "base-sepolia" | null;
            agentBookAddress: string | null;
        };
        identity: {
            verified: boolean;
            registryAddress: string | null;
            agentId: string | null;
            registryChain: string | null;
            tokenURI: string | null;
            owner: string | null;
        };
        context: {
            found: boolean;
            raw: string | null;
            parsed: Record<string, unknown> | null;
            skillUrl: string | null;
        };
        skill: {
            found: boolean;
            domainVerified: boolean;
            content: string | null;
            url: string | null;
        };
    }, {
        ensName: string;
        manifest: {
            found: boolean;
            latestVersion: string | null;
            lineageMode: string | null;
            manifest: {
                schema: string;
                ensName: string;
                version: string;
                prev: string | null;
                payload: Record<string, unknown>;
                signature: {
                    value: string;
                    scheme: string;
                };
                manifestHash?: string | undefined;
            } | null;
            signatureValid: boolean;
            lineageDepth: number;
            lineageIntact: boolean;
        };
        address: string | null;
        resolvedAt: number;
        trustScore: "none" | "registered" | "discoverable" | "verified" | "full";
        personhood: {
            verified: boolean;
            nullifierHash: string | null;
            network: "base" | "world" | "base-sepolia" | null;
            agentBookAddress: string | null;
        };
        identity: {
            verified: boolean;
            registryAddress: string | null;
            agentId: string | null;
            registryChain: string | null;
            tokenURI: string | null;
            owner: string | null;
        };
        context: {
            found: boolean;
            raw: string | null;
            parsed: Record<string, unknown> | null;
            skillUrl: string | null;
        };
        skill: {
            found: boolean;
            domainVerified: boolean;
            content: string | null;
            url: string | null;
        };
    }>;
    policy: z.ZodObject<{
        minTier: z.ZodDefault<z.ZodEnum<["none", "registered", "discoverable", "verified", "full"]>>;
        requireLineage: z.ZodDefault<z.ZodBoolean>;
        requireSig: z.ZodDefault<z.ZodBoolean>;
        allowSelf: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        minTier: "none" | "registered" | "discoverable" | "verified" | "full";
        requireLineage: boolean;
        requireSig: boolean;
        allowSelf: boolean;
    }, {
        minTier?: "none" | "registered" | "discoverable" | "verified" | "full" | undefined;
        requireLineage?: boolean | undefined;
        requireSig?: boolean | undefined;
        allowSelf?: boolean | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    allow: boolean;
    reason: string;
    profile: {
        ensName: string;
        manifest: {
            found: boolean;
            latestVersion: string | null;
            lineageMode: string | null;
            manifest: {
                schema: string;
                ensName: string;
                version: string;
                prev: string | null;
                payload: Record<string, unknown>;
                signature: {
                    value: string;
                    scheme: string;
                };
                manifestHash?: string | undefined;
            } | null;
            signatureValid: boolean;
            lineageDepth: number;
            lineageIntact: boolean;
        };
        address: string | null;
        resolvedAt: number;
        trustScore: "none" | "registered" | "discoverable" | "verified" | "full";
        personhood: {
            verified: boolean;
            nullifierHash: string | null;
            network: "base" | "world" | "base-sepolia" | null;
            agentBookAddress: string | null;
        };
        identity: {
            verified: boolean;
            registryAddress: string | null;
            agentId: string | null;
            registryChain: string | null;
            tokenURI: string | null;
            owner: string | null;
        };
        context: {
            found: boolean;
            raw: string | null;
            parsed: Record<string, unknown> | null;
            skillUrl: string | null;
        };
        skill: {
            found: boolean;
            domainVerified: boolean;
            content: string | null;
            url: string | null;
        };
    };
    policy: {
        minTier: "none" | "registered" | "discoverable" | "verified" | "full";
        requireLineage: boolean;
        requireSig: boolean;
        allowSelf: boolean;
    };
}, {
    allow: boolean;
    reason: string;
    profile: {
        ensName: string;
        manifest: {
            found: boolean;
            latestVersion: string | null;
            lineageMode: string | null;
            manifest: {
                schema: string;
                ensName: string;
                version: string;
                prev: string | null;
                payload: Record<string, unknown>;
                signature: {
                    value: string;
                    scheme: string;
                };
                manifestHash?: string | undefined;
            } | null;
            signatureValid: boolean;
            lineageDepth: number;
            lineageIntact: boolean;
        };
        address: string | null;
        resolvedAt: number;
        trustScore: "none" | "registered" | "discoverable" | "verified" | "full";
        personhood: {
            verified: boolean;
            nullifierHash: string | null;
            network: "base" | "world" | "base-sepolia" | null;
            agentBookAddress: string | null;
        };
        identity: {
            verified: boolean;
            registryAddress: string | null;
            agentId: string | null;
            registryChain: string | null;
            tokenURI: string | null;
            owner: string | null;
        };
        context: {
            found: boolean;
            raw: string | null;
            parsed: Record<string, unknown> | null;
            skillUrl: string | null;
        };
        skill: {
            found: boolean;
            domainVerified: boolean;
            content: string | null;
            url: string | null;
        };
    };
    policy: {
        minTier?: "none" | "registered" | "discoverable" | "verified" | "full" | undefined;
        requireLineage?: boolean | undefined;
        requireSig?: boolean | undefined;
        allowSelf?: boolean | undefined;
    };
}>;
type GateDecision = z.infer<typeof GateDecisionSchema>;
declare function gate(profile: TrustProfile, policy: TrustPolicy, callerEns?: string): GateDecision;

interface CreateLocalSignerOptions {
    /** 0x-prefixed 32-byte private key. */
    privateKey: Hex;
    /** viem chain config (e.g. base, baseSepolia from "viem/chains"). */
    chain: Chain;
    /** RPC URL for the chain. */
    rpc: string;
}
/**
 * Create a Signer backed by a viem WalletClient over a private-key EOA.
 *
 * For early development and as a fallback when smart-account signers (Namera)
 * are unavailable. EOAs cannot atomically batch — `Batch.atomic === true` is
 * honored as best-effort sequential sends, with a console.warn if more than
 * one call would be lost. Use `createNameraSigner` for true atomic batches
 * via ERC-4337.
 */
declare function createLocalSigner(opts: CreateLocalSignerOptions): Signer;

interface CreateNameraSignerOptions {
    /**
     * Returns the base64-serialized session-key permission account string.
     *
     * IO is dependency-injected so the resolver stays free of Node-only deps
     * (allowing the package to be safely consumed by browser bundlers like
     * Next.js webpack). Callers in Node typically pass:
     *   `() => readFile(path, "utf-8").then(s => s.trim())`
     */
    readSessionKey: () => Promise<string>;
    /** 0x-prefixed 32-byte private key for the session signer (NOT the owner key). */
    sessionKeyPrivateKey: Hex;
    /** ERC-4337 bundler URL for the chain (Pimlico/Alchemy). */
    bundlerUrl: string;
    /** viem chain config (e.g. base from "viem/chains"). */
    chain: Chain;
    /** RPC URL for the public client. */
    rpc: string;
    /** ERC-4337 entrypoint version. Defaults to "0.7". */
    entrypointVersion?: EntryPointVersion;
    /**
     * ZeroDev kernel version (e.g. KERNEL_V3_3 from @zerodev/sdk/constants).
     * Must match what the session key was issued for.
     */
    kernelVersion: any;
}
/**
 * Create a Signer backed by a Namera session-key client (ZeroDev kernel account
 * via @namera-ai/sdk).
 *
 * **Execution-only.** This adapter consumes a previously-issued, serialized
 * session key plus the session signer's private key. It does NOT require or
 * instantiate the owner key — the owner key lives in an encrypted keystore
 * off-droplet, used only at session-key issuance time (a one-time ceremony
 * the consuming application performs separately).
 *
 * **Policy-agnostic.** Onchain policies (call / gas / rate-limit / timestamp)
 * are baked into the session key during issuance. What this signer can and
 * cannot do is determined by the validator state on chain, not by anything
 * here. Consuming apps choose their policies during issuance.
 *
 * `execute(batches)` forwards to `executeTransaction` and returns the LAST
 * batch's onchain transaction hash (extracted from its UserOperationReceipt).
 * Throws if every batch failed to broadcast.
 */
declare function createNameraSigner(opts: CreateNameraSignerOptions): Promise<Signer>;

/**
 * Signer abstraction — uniform interface for "this address signs and broadcasts
 * a transaction." Two adapters live alongside this file:
 *
 *   - createLocalSigner — viem WalletClient over a private-key EOA
 *   - createNameraSigner — ZeroDev kernel account via @namera-ai/sdk
 *
 * The resolver itself is read-only; this module exists in packages/resolver
 * because that's where the schema + utilities live, but it performs no
 * resolution. Consuming applications (e.g. TrustSwap) wire signers + gate()
 * together to express "resolve who → decide allow → sign and broadcast."
 */
/** A logical batch of contract calls. EOAs ignore `atomic` and send sequentially. */
interface Batch {
    chainId: number;
    /**
     * When true, all `calls` execute as a single onchain transaction. Smart-account
     * signers (Namera) honor this; EOA signers (local) emit a warning and fall
     * back to sequential sends.
     */
    atomic: boolean;
    /**
     * Optional ZeroDev custom nonce key. Smart-account signers (Namera) use this
     * to run independent batches in parallel nonce lanes via `executeTransaction`.
     * EOA signers (local) ignore this field — Ethereum's per-address nonce is
     * strictly sequential, so EOAs have no equivalent concept.
     */
    nonceKey?: string;
    calls: Array<{
        to: `0x${string}`;
        data: `0x${string}`;
        value: bigint;
    }>;
}
/** A signer over the {@link Batch} shape. Returned by adapter factories. */
interface Signer {
    /** Address that signs and submits — EOA address for local, kernel account address for namera. */
    address: `0x${string}`;
    /**
     * Submit one or more batches; returns the broadcast tx hash (or user-op hash,
     * depending on the adapter's receipt handling).
     *
     * Multiple batches are processed in array order. Within a single batch, calls
     * are sent in order — and atomically as a single tx if `batch.atomic === true`
     * and the signer supports it.
     */
    execute(batches: Batch[]): Promise<`0x${string}`>;
}

export { AgentBookNetwork, type AgentManifest, AgentManifestSchema, AgentManifestSignatureSchema, type Batch, type ContextResult, ContextResultSchema, type CreateLocalSignerOptions, type CreateNameraSignerOptions, type GateDecision, GateDecisionSchema, type IdentityResult, IdentityResultSchema, KNOWN_REGISTRIES, type ManifestResult, ManifestResultSchema, type PersonhoodResult, PersonhoodResultSchema, type ResolveContextOptions, type ResolveIdentityOptions, type ResolveManifestOptions, type ResolveOptions, type ResolvePersonhoodOptions, type ResolveSkillOptions, type Signer, type SkillResult, SkillResultSchema, type TrustPolicy, TrustPolicySchema, type TrustProfile, TrustProfileSchema, TrustTier, buildEnsip25Key, cidToGatewayUrl, cidToUri, createEnsClient, createLocalSigner, createNameraSigner, decodeErc7930Address, encodeErc7930Address, extractCid, fetchFromIpfs, fetchJsonFromIpfs, gate, getOwner, getTextRecord, getTextRecords, normalizeName, parseEnsip25Key, resolve, resolveAddress, resolveContext, resolveIdentity, resolveManifest, resolvePersonhood, resolveSkill };
