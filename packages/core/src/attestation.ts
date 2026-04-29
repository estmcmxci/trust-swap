import type { Address, Hex } from "viem";
import type { TrustTier } from "@synthesis/resolver";

// ---------------------------------------------------------------------------
// Attestation wire types
//
// These define the contract between the off-chain orchestrate path and the
// oracle service. The on-chain `TrustSwapRouter` verifies a signed
// `Attestation` matching this exact field order — see `gatedSwap` in
// `packages/contracts/src/TrustSwapRouter.sol`.
//
// Lives in `@trust-swap/core` (not `@trust-swap/oracle`) so the oracle
// package can depend on core without creating a cycle. Phase 1 had the
// types in oracle and core re-imported them; that placed core's risk-policy
// helper out of reach of the oracle.
// ---------------------------------------------------------------------------

export interface AttestRequest {
  /**
   * Swapper's ENS name. Optional in the wire type so the Phase 1 mock keeps
   * working, but the real HTTP oracle (Phase 2+) requires it and uses it to
   * re-resolve the swapper's TrustProfile via TRL.
   */
  swapperEns?: string;
  /** Recipient's ENS name; same conditional-requirement as `swapperEns`. */
  recipientEns?: string;
  /** Address claimed for the swapper. The HTTP oracle verifies it against
   * the resolved `swapperEns`. */
  swapper: Address;
  /** Address claimed for the recipient. Same verification. */
  recipient: Address;
  tokenIn: Address;
  tokenOut: Address;
  /** Decimal-string amount in the token's base units (e.g. "1000000" = 1 USDC). */
  amountIn: string;
  /**
   * Decimal-string expected output amount in `tokenOut` base units. Used
   * by the oracle's reverse-direction RiskPolicy check to enforce the
   * swapper's `maxAcceptedSize` against the token they receive.
   */
  amountOut?: string;
  /**
   * `keccak256(universalRouterCalldata)`. The oracle binds this hash into
   * the signed attestation; the on-chain router refuses to forward calldata
   * that hashes to anything else. Without this binding, a valid attestation
   * could be replayed against a different swap shape.
   */
  calldataHash?: Hex;
}

/** The canonical attestation tuple — encoded with `abi.encode(att)` on chain. */
export interface Attestation {
  swapper: Address;
  recipient: Address;
  swapperTier: TrustTier;
  recipientTier: TrustTier;
  /** Unix timestamp in seconds; the router rejects attestations past this. */
  expiresAt: number;
  /** Per-swapper nonce; the router rejects re-broadcasts of the same nonce. */
  nonce: number;
  /**
   * `keccak256(universalRouterCalldata)`. Binds the attestation to the
   * specific swap shape the oracle saw — different calldata means a
   * different swap, which the contract refuses to forward.
   */
  calldataHash: Hex;
}

export interface AttestResponse {
  attestation: Attestation;
  /** secp256k1 signature over `keccak256(abi.encode(attestation))` by ORACLE_PRIVATE_KEY. */
  signature: Hex;
}

export interface AttestErrorResponse {
  error: string;
  /** Optional onboarding hint (e.g. "register on AgentBook"). */
  hint?: string;
}
