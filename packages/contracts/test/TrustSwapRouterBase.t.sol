// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {TrustSwapRouter} from "../src/TrustSwapRouter.sol";

/// @notice Records every call it receives so tests can assert byte-perfect
///         calldata forwarding without actually executing a swap. `vm.etch`
///         puts this bytecode at `UNIVERSAL_ROUTER`'s address.
contract MockUniversalRouter {
    event MockCalled(uint256 value, bytes data);

    fallback() external payable {
        emit MockCalled(msg.value, msg.data);
    }

    receive() external payable {}
}

/// @notice Shared fixtures for every TrustSwapRouter test. Subclasses build
///         attestations with `_buildAttestation(...)` and sign them with
///         `_signAttestation(...)`; both use a deterministic oracle keypair
///         seeded in `setUp()`.
abstract contract TrustSwapRouterBaseTest is Test {
    TrustSwapRouter internal router;

    address internal constant UNIVERSAL_ROUTER =
        0x6fF5693b99212Da76ad316178A184AB56D299b43;

    address internal feeRecipient = address(0xFEE);
    address internal swapper = address(0xA11CE);
    address internal recipient = address(0xB0B);

    /// @dev Deterministic oracle keypair so `vm.sign` produces stable
    ///      signatures across runs. The private key never leaves this file.
    uint256 internal oraclePrivKey =
        uint256(keccak256(abi.encodePacked("trustswap-oracle-test-key")));
    address internal oraclePubkey;

    /// @dev Calldata that will be byte-perfect-forwarded to the mocked UR.
    bytes internal forwardedCalldata = hex"deadbeefcafebabe";

    function setUp() public virtual {
        oraclePubkey = vm.addr(oraclePrivKey);
        router = new TrustSwapRouter(oraclePubkey, feeRecipient);

        // Etch the mock UR's runtime code at the canonical Base address so
        // `gatedSwap` can call it without us deploying a real Universal
        // Router fork.
        MockUniversalRouter mock = new MockUniversalRouter();
        vm.etch(UNIVERSAL_ROUTER, address(mock).code);

        // Set a stable wall clock so freshness checks have a known anchor.
        vm.warp(1_700_000_000);

        // Default fee recipient balance to 0 so per-test fee assertions
        // start from a clean slate.
        vm.deal(feeRecipient, 0);
    }

    function _buildAttestation(
        TrustSwapRouter.TrustTier swapperTier,
        TrustSwapRouter.TrustTier recipientTier,
        uint256 nonce
    ) internal view returns (TrustSwapRouter.Attestation memory) {
        return _buildAttestationWithCalldata(
            swapperTier,
            recipientTier,
            nonce,
            forwardedCalldata
        );
    }

    /// Variant for tests that forward a non-default calldata payload —
    /// the calldataHash in the attestation must match exactly.
    function _buildAttestationWithCalldata(
        TrustSwapRouter.TrustTier swapperTier,
        TrustSwapRouter.TrustTier recipientTier,
        uint256 nonce,
        bytes memory forwarded
    ) internal view returns (TrustSwapRouter.Attestation memory) {
        return
            TrustSwapRouter.Attestation({
                swapper: swapper,
                recipient: recipient,
                swapperTier: swapperTier,
                recipientTier: recipientTier,
                expiresAt: block.timestamp + 5 minutes,
                nonce: nonce,
                calldataHash: keccak256(forwarded)
            });
    }

    function _signAttestation(TrustSwapRouter.Attestation memory att)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = keccak256(abi.encode(att));
        bytes32 signedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", digest)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePrivKey, signedHash);
        return abi.encodePacked(r, s, v);
    }
}
