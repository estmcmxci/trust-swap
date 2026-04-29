import { existsSync } from "node:fs";
import { generatePrivateKey } from "viem/accounts";
import { base } from "viem/chains";
import { createLocalSigner, type Signer } from "@synthesis/resolver";

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
 * env vars are present, else `local`. Phase 1 only supports `local` —
 * `namera` is wired in Phase 2 (TRU-50 issues the session key + serializes
 * to NAMERA_SESSION_KEY_PATH).
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
    throw new Error(
      "namera signer not wired in Phase 1 — session-key issuance ceremony is deferred to Phase 2 (TRU-50). Use --signer local for now.",
    );
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

/** Truthy iff the file at the path exists and is readable. */
export function keystoreFileExists(path: string | undefined): boolean {
  if (!path) return false;
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}
