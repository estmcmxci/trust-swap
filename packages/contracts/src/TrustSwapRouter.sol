// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Permit2 surface used by the router. Universal Router pulls input
///         tokens via `Permit2.transferFrom(payer, ...)` for CLASSIC swaps
///         where `payerIsUser=true`. When the router is the caller into UR,
///         "payer" is THIS contract, so this contract must (a) approve
///         Permit2 on the ERC20 (`IERC20.approve`) and (b) approve UR via
///         Permit2 to actually spend it (`IPermit2.approve`). Both are set
///         in `_setApprovals`.
interface IPermit2 {
    function approve(
        address token,
        address spender,
        uint160 amount,
        uint48 expiration
    ) external;
}

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
///
///         v2 (TRU-86) introduces ERC20-input support. The original v1
///         contract forwarded UR calldata via low-level call — but UR's
///         `PERMIT2_TRANSFER_FROM` resolves payer = msg.sender, which is
///         this router (holding zero tokens), causing every ERC20-input
///         swap to revert. v2 adds three things:
///           1. `gatedSwap` accepts `(payer, tokenIn, amountIn)`. When
///              `payer != address(0)`, the router pulls `amountIn` of
///              `tokenIn` via `transferFrom(payer, this, …)` BEFORE
///              forwarding to UR. The kernel must approve THIS router for
///              the input token (`IERC20.approve(router, max)`).
///           2. The router pre-approves Permit2 (and, via Permit2, UR) for
///              every token passed to the constructor's `initialApprovals`
///              array. Production: `[WETH, USDC]`. Tests: `[]`.
///           3. A permissionless `setApprovals(token)` lets future tokens
///              be supported without a redeploy. No admin gating; calling
///              it just sets max approvals to known infrastructure
///              addresses, which is safe to permit globally.
contract TrustSwapRouter {
    using SafeERC20 for IERC20;

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
    /// @dev    `calldataHash` binds the attestation to the FULL gated-swap
    ///         payload — `keccak256(abi.encode(payer, tokenIn, amountIn,
    ///         universalRouterCalldata))`. Without binding the pull params
    ///         too, a front-runner who saw a valid attestation+sig in flight
    ///         could resubmit it with a larger `amountIn`: the router would
    ///         pull the larger amount from `att.swapper` (whose kernel had
    ///         approved max), the UR call would still succeed using the
    ///         original amount encoded in the calldata, and the excess
    ///         would be stranded in the router while the nonce burned.
    ///         (Codex P1 #15.)
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

    /// @notice Permit2 (Uniswap canonical) — same address on every chain.
    address public constant PERMIT2 =
        0x000000000022D473030F116dDEE9F6B43aC78BA3;

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

    /// @notice Tokens for which `setApprovals` has been called at least
    ///         once. Read by clients to skip a redundant approval call.
    mapping(address token => bool ready) public approvalsReady;

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

    /// @notice Emitted when `setApprovals(token)` runs (either via the
    ///         constructor's `initialApprovals` array or a later call).
    event ApprovalsSet(address indexed token);

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
    error PayerNotAttestedSwapper(address payer, address attestedSwapper);

    constructor(
        address oraclePubkey,
        address feeRecipient,
        address[] memory initialApprovals
    ) {
        if (oraclePubkey == address(0)) revert ZeroOraclePubkey();
        if (feeRecipient == address(0)) revert ZeroFeeRecipient();
        ORACLE_PUBKEY = oraclePubkey;
        FEE_RECIPIENT = feeRecipient;

        // Pre-approve Permit2 + UR for every token the deployer marked as
        // expected-input. Production deploys with [WETH, USDC]; tests
        // deploy with [] so a fresh forge environment doesn't touch
        // address-with-no-code Permit2.
        for (uint256 i = 0; i < initialApprovals.length; i++) {
            _setApprovals(initialApprovals[i]);
        }
    }

    /// @notice Permissionless. Sets max ERC20 + Permit2 allowance for the
    ///         given token to Permit2 and UR respectively, so UR can pull
    ///         `token` from this router during a `gatedSwap`. Safe to
    ///         leave permissionless — anyone calling this only authorizes
    ///         the canonical Uniswap infra; the router holds no tokens
    ///         except mid-`gatedSwap` and never voluntarily transfers
    ///         elsewhere.
    function setApprovals(address token) external {
        _setApprovals(token);
    }

    function _setApprovals(address token) internal {
        // forceApprove handles tokens (e.g. USDT) that revert on approve()
        // when current allowance is non-zero. WETH + USDC don't, but the
        // permissionless setApprovals path may receive arbitrary ERC20s.
        IERC20(token).forceApprove(PERMIT2, type(uint256).max);
        IPermit2(PERMIT2).approve(
            token,
            UNIVERSAL_ROUTER,
            type(uint160).max,
            type(uint48).max
        );
        approvalsReady[token] = true;
        emit ApprovalsSet(token);
    }

    /// @notice Verify the oracle attestation, apply tier-bucket terms,
    ///         deduct the fee, then forward the Universal Router calldata.
    /// @param payer When non-zero, the router pulls `amountIn` of
    ///        `tokenIn` from `payer` via `transferFrom` before calling UR.
    ///        Bound to `att.swapper` so an unrelated approver cannot be
    ///        drained by a third party. For ETH-input swaps, pass
    ///        `address(0)` and the router uses `msg.value` directly.
    /// @param tokenIn Address of the input ERC20. Ignored when
    ///        `payer == address(0)`.
    /// @param amountIn Exact amount the router pulls from `payer` to
    ///        cover UR's Permit2-side pull. Should match the input amount
    ///        encoded in `universalRouterCalldata`; if it doesn't, the
    ///        UR call may revert (over-pull) or leave dust in this
    ///        contract (under-pull). Either way the swap doesn't go
    ///        through silently — over-pull is bounded by the kernel's
    ///        approval to this router, which the kernel sets explicitly.
    /// @dev   v1's cap was enforced against `msg.value` only — i.e. native
    ///        ETH input swaps. ERC20-input swaps still have `msg.value == 0`,
    ///        so the on-chain cap doesn't fire on them; for those, the
    ///        oracle's off-chain RiskPolicy + tier-bucket pre-flight are
    ///        the authoritative cap. Phase 3 unifies via `amountInUsd` in
    ///        the attestation tuple.
    function gatedSwap(
        address payer,
        address tokenIn,
        uint256 amountIn,
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
        //    to forward AND the pull params (payer, tokenIn, amountIn).
        //    Hashing only `universalRouterCalldata` would let a front-runner
        //    replay a valid attestation+sig with a larger `amountIn`,
        //    over-pulling from `att.swapper` while UR still consumed only
        //    the original amount encoded in the calldata. (Codex P1 #15.)
        bytes32 actualCalldataHash = keccak256(
            abi.encode(payer, tokenIn, amountIn, universalRouterCalldata)
        );
        if (actualCalldataHash != att.calldataHash) {
            revert CalldataHashMismatch(att.calldataHash, actualCalldataHash);
        }

        // 3. Replay protection — every (swapper, nonce) pair is single-use.
        if (usedNonce[att.swapper][att.nonce]) {
            revert NonceAlreadyUsed(att.swapper, att.nonce);
        }
        usedNonce[att.swapper][att.nonce] = true;

        // 4. Freshness — attestations expire to bound the gap between
        //    oracle resolution and on-chain settlement.
        if (block.timestamp > att.expiresAt) {
            revert AttestationExpired(att.expiresAt, block.timestamp);
        }

        // 5. Floor — tier=none is never eligible, regardless of which side
        //    is `none`. Every other tier proceeds with graded terms.
        if (
            att.swapperTier == TrustTier.None ||
            att.recipientTier == TrustTier.None
        ) {
            revert TierNone();
        }

        // 6. Stricter-wins join — both knobs use the lower of the two tiers.
        TrustTier effective = _minTier(att.swapperTier, att.recipientTier);
        uint256 cap = _maxTradeSize(effective);
        uint256 bps = _feeBps(effective);

        // 7. Cap — see @dev note above re: ERC20 paths (cap fires on
        //    msg.value only; ERC20 inputs are bound off-chain).
        if (msg.value > cap) revert AmountExceedsCap(msg.value, cap);

        // 8. Fee deduction. Use call{value} so the fee recipient can be a
        //    contract (e.g. a Safe or future fee-distribution module).
        uint256 fee = (msg.value * bps) / 10_000;
        if (fee > 0) {
            (bool feeOk, ) = FEE_RECIPIENT.call{value: fee}("");
            if (!feeOk) revert FeeTransferFailed();
        }
        uint256 forwardValue = msg.value - fee;

        // 9. ERC20 pull — only when caller opted in via non-zero payer.
        //    Bind to `att.swapper` so an unrelated user who happens to
        //    have approved this router can't be drained by a third party
        //    submitting an attestation on someone else's behalf. The
        //    oracle attests `swapper`; therefore only the attested
        //    swapper can be charged.
        if (payer != address(0) && amountIn > 0) {
            if (payer != att.swapper) {
                revert PayerNotAttestedSwapper(payer, att.swapper);
            }
            IERC20(tokenIn).safeTransferFrom(payer, address(this), amountIn);
        }

        // 10. Forward to Universal Router. Bubble its revert reason verbatim
        //     so off-chain debugging matches what the wrapped router would
        //     return when called directly.
        (bool ok, bytes memory ret) = UNIVERSAL_ROUTER.call{
            value: forwardValue
        }(universalRouterCalldata);
        if (!ok) revert UniversalRouterCallFailed(ret);

        // 11. Emit observability log.
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
