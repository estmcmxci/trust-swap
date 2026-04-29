// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title TrustSwapRouter — reputation-graded settlement on Uniswap
/// @notice Wraps Uniswap's Universal Router with off-chain attestation
///         verification + tier-bucket execution terms. Every call must
///         present an attestation signed by the trusted oracle; tier=none
///         on either side reverts at the floor, every other tier is
///         admitted with graded caps and fees.
/// @dev    The off-chain `tierBucket` table at `packages/core/src/policy.ts`
///         is mirrored here byte-for-byte. Any change to one MUST update the
///         other or the off-chain pre-flight will diverge from on-chain
///         enforcement.
contract TrustSwapRouter {
    /// @notice Tier ordinals — must match `TIER_INDEX` in
    ///         `packages/core/src/orchestrate.ts` and the off-chain
    ///         `policy.ts` enum.
    enum TrustTier {
        None,         // 0 — floor; gatedSwap reverts
        Registered,   // 1
        Discoverable, // 2
        Verified,     // 3
        Full          // 4
    }

    /// @notice Canonical attestation bytes the oracle signs over
    ///         `keccak256(abi.encode(att))`. The same shape is encoded by
    ///         `buildGatedSwapCalldata()` off-chain.
    /// @dev    `calldataHash` binds the attestation to a specific
    ///         `universalRouterCalldata` payload — without it, a caller
    ///         could replay a valid attestation against a different swap
    ///         (different tokens, different amounts, different
    ///         pools), bypassing the off-chain checks the oracle ran.
    struct Attestation {
        address swapper;
        address recipient;
        TrustTier swapperTier;
        TrustTier recipientTier;
        uint256 expiresAt;
        uint256 nonce;
        bytes32 calldataHash;
    }

    /// @notice Uniswap Universal Router on Base mainnet (chainId 8453).
    ///         Forwarded to via low-level call after gates pass.
    address public constant UNIVERSAL_ROUTER =
        0x6fF5693b99212Da76ad316178A184AB56D299b43;

    /// @notice Address of the oracle's signing key. Set at construction;
    ///         cannot be rotated post-deploy in v1 (rotation policy is a
    ///         post-hackathon concern documented in `spec/trust-graded-swap.md`).
    address public immutable ORACLE_PUBKEY;

    /// @notice Recipient of the per-swap fee (oracle operator in v1).
    ///         Made immutable so the contract address stays CREATE2-stable.
    address public immutable FEE_RECIPIENT;

    /// @notice Per-swapper nonce table. The oracle SHOULD issue strictly
    ///         increasing nonces; the router stores any-seen-nonce as used
    ///         and rejects re-broadcasts.
    mapping(address swapper => mapping(uint256 nonce => bool used))
        public usedNonce;

    /// @notice Emitted on every successful `gatedSwap`. Indexed digest +
    ///         swapper for off-chain analytics; effective tier and fee are
    ///         in the data slot for cheap log scanning.
    event GatedSwap(
        bytes32 indexed attestationDigest,
        address indexed swapper,
        address indexed recipient,
        TrustTier effectiveTier,
        uint256 amountInValue,
        uint256 feeWei
    );

    error ZeroOraclePubkey();
    error ZeroFeeRecipient();
    error TierNone();
    error AttestationExpired(uint256 deadline, uint256 nowTs);
    error NonceAlreadyUsed(address swapper, uint256 nonce);
    error BadOracleSignature(address recovered);
    error CalldataHashMismatch(bytes32 expected, bytes32 actual);
    error AmountExceedsCap(uint256 amount, uint256 cap);
    error UniversalRouterCallFailed(bytes returndata);
    error FeeTransferFailed();

    constructor(address oraclePubkey, address feeRecipient) {
        if (oraclePubkey == address(0)) revert ZeroOraclePubkey();
        if (feeRecipient == address(0)) revert ZeroFeeRecipient();
        ORACLE_PUBKEY = oraclePubkey;
        FEE_RECIPIENT = feeRecipient;
    }

    /// @notice Verify the oracle attestation, apply tier-bucket terms,
    ///         deduct the fee, then forward the Universal Router calldata.
    /// @dev    The cap in v1 is enforced against `msg.value` — i.e. native
    ///         ETH input swaps. ERC20-input swaps pass `msg.value == 0`
    ///         and the on-chain cap does not fire; for those, the oracle's
    ///         off-chain RiskPolicy + tier-bucket pre-flight are the
    ///         authoritative cap. Phase 3 unifies via `amountInUsd` in the
    ///         attestation tuple.
    function gatedSwap(
        bytes calldata universalRouterCalldata,
        Attestation calldata att,
        bytes calldata oracleSig
    ) external payable {
        // 1. Verify oracle signature over EIP-191-prefixed digest. Using
        //    EIP-191 (eth_sign style) keeps off-chain signing portable
        //    across viem.signMessage / ethers.signMessage / cast wallet sign.
        bytes32 digest = keccak256(abi.encode(att));
        bytes32 signedHash = MessageHashUtils.toEthSignedMessageHash(digest);
        address recovered = ECDSA.recover(signedHash, oracleSig);
        if (recovered != ORACLE_PUBKEY) revert BadOracleSignature(recovered);

        // 2. Calldata binding — the oracle signed an attestation that
        //    includes a hash of the EXACT calldata it expected the caller
        //    to forward. If the calldata here doesn't match, the
        //    attestation is being replayed against a different swap
        //    (different tokens, amounts, pools, recipient overrides).
        bytes32 actualCalldataHash = keccak256(universalRouterCalldata);
        if (actualCalldataHash != att.calldataHash) {
            revert CalldataHashMismatch(att.calldataHash, actualCalldataHash);
        }

        // 3. Replay protection — every (swapper, nonce) pair is single-use.
        if (usedNonce[att.swapper][att.nonce]) {
            revert NonceAlreadyUsed(att.swapper, att.nonce);
        }
        usedNonce[att.swapper][att.nonce] = true;

        // 3. Freshness — attestations expire to bound the gap between
        //    oracle resolution and on-chain settlement.
        if (block.timestamp > att.expiresAt) {
            revert AttestationExpired(att.expiresAt, block.timestamp);
        }

        // 4. Floor — tier=none is never eligible, regardless of which side
        //    is `none`. Every other tier proceeds with graded terms.
        if (
            att.swapperTier == TrustTier.None ||
            att.recipientTier == TrustTier.None
        ) {
            revert TierNone();
        }

        // 5. Stricter-wins join — both knobs use the lower of the two tiers.
        TrustTier effective = _minTier(att.swapperTier, att.recipientTier);
        uint256 cap = _maxTradeSize(effective);
        uint256 bps = _feeBps(effective);

        // 6. Cap — see @dev note above re: ERC20 paths.
        if (msg.value > cap) revert AmountExceedsCap(msg.value, cap);

        // 7. Fee deduction. Use call{value} so the fee recipient can be a
        //    contract (e.g. a Safe or future fee-distribution module).
        uint256 fee = (msg.value * bps) / 10_000;
        if (fee > 0) {
            (bool feeOk, ) = FEE_RECIPIENT.call{value: fee}("");
            if (!feeOk) revert FeeTransferFailed();
        }
        uint256 forwardValue = msg.value - fee;

        // 8. Forward to Universal Router. Bubble its revert reason verbatim
        //    so off-chain debugging matches what the wrapped router would
        //    return when called directly.
        (bool ok, bytes memory ret) = UNIVERSAL_ROUTER.call{
            value: forwardValue
        }(universalRouterCalldata);
        if (!ok) revert UniversalRouterCallFailed(ret);

        // 9. Emit observability log.
        emit GatedSwap(
            digest,
            att.swapper,
            att.recipient,
            effective,
            msg.value,
            fee
        );
    }

    // ------------------------------------------------------------------
    // Tier-bucket tables
    //
    // The values below MUST match the off-chain `tierBucket` constant in
    // `packages/core/src/policy.ts`. Any change here requires updating
    // both files.
    //
    // Note on units: `cap` is in wei (native chain unit) for v1. The
    // off-chain table values are equal-magnitude — `tier=verified` is
    // 5_000_000_000n in TS and 5e9 wei here. Phase 3+ may unify by adding
    // `amountInUsd` to the Attestation tuple and switching to USD-cap.
    // ------------------------------------------------------------------

    function _maxTradeSize(TrustTier tier)
        internal
        pure
        returns (uint256)
    {
        if (tier == TrustTier.Full) return type(uint256).max;
        if (tier == TrustTier.Verified) return 5_000_000_000;
        if (tier == TrustTier.Discoverable) return 500_000_000;
        if (tier == TrustTier.Registered) return 50_000_000;
        revert TierNone();
    }

    function _feeBps(TrustTier tier) internal pure returns (uint256) {
        if (tier == TrustTier.Full) return 0;
        if (tier == TrustTier.Verified) return 25;
        if (tier == TrustTier.Discoverable) return 50;
        if (tier == TrustTier.Registered) return 100;
        revert TierNone();
    }

    function _minTier(TrustTier a, TrustTier b)
        internal
        pure
        returns (TrustTier)
    {
        return uint8(a) < uint8(b) ? a : b;
    }

    /// @notice Reject bare native-token transfers — every value transfer
    ///         must come through `gatedSwap`. Stops accidental sends from
    ///         staying stuck on the contract.
    receive() external payable {
        revert("TrustSwapRouter: direct send disallowed");
    }
}
