// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TrustSwapRouter} from "../src/TrustSwapRouter.sol";
import {TrustSwapRouterBaseTest} from "./TrustSwapRouterBase.t.sol";

/// @notice TRU-54 — oracle signature verification, replay protection,
///         freshness, fee math, and Universal Router calldata + value
///         forwarding.
contract TrustSwapRouterCryptoTest is TrustSwapRouterBaseTest {
    // -------------------------------------------------------------------
    // Signature verification
    // -------------------------------------------------------------------

    function test_RejectsBadOracleSignature() public {
        // Sign with an unrelated private key — recover() returns a non-
        // ORACLE_PUBKEY address, contract reverts with BadOracleSignature.
        TrustSwapRouter.Attestation memory att = _buildAttestation(
            TrustSwapRouter.TrustTier.Verified,
            TrustSwapRouter.TrustTier.Verified,
            100
        );

        uint256 wrongPrivKey = uint256(keccak256("not-the-oracle"));
        bytes32 digest = keccak256(abi.encode(att));
        bytes32 signedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", digest)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongPrivKey, signedHash);
        bytes memory badSig = abi.encodePacked(r, s, v);

        vm.expectRevert(
            abi.encodeWithSelector(
                TrustSwapRouter.BadOracleSignature.selector,
                vm.addr(wrongPrivKey)
            )
        );
        router.gatedSwap{value: 1_000_000}(forwardedCalldata, att, badSig);
    }

    function test_RejectsTamperedAttestation() public {
        // Sign a clean attestation, then flip a byte (the recipient
        // address). The recovered signer no longer matches ORACLE_PUBKEY.
        TrustSwapRouter.Attestation memory clean = _buildAttestation(
            TrustSwapRouter.TrustTier.Verified,
            TrustSwapRouter.TrustTier.Verified,
            101
        );
        bytes memory sig = _signAttestation(clean);

        TrustSwapRouter.Attestation memory tampered = clean;
        tampered.recipient = address(0xDEADBEEF); // changed post-sign

        // Recovered address is non-deterministic (depends on the tampered
        // digest), so we match the selector prefix rather than the full
        // revert data.
        vm.expectPartialRevert(TrustSwapRouter.BadOracleSignature.selector);
        router.gatedSwap{value: 1_000_000}(forwardedCalldata, tampered, sig);
    }

    function test_AcceptsValidOracleSignature() public {
        TrustSwapRouter.Attestation memory att = _buildAttestation(
            TrustSwapRouter.TrustTier.Verified,
            TrustSwapRouter.TrustTier.Verified,
            102
        );
        bytes memory sig = _signAttestation(att);
        // No revert expected; emit + state changes verified by other tests.
        router.gatedSwap{value: 1_000_000}(forwardedCalldata, att, sig);
        assertTrue(
            router.usedNonce(swapper, 102),
            "nonce should be marked used after valid sig"
        );
    }

    // -------------------------------------------------------------------
    // Replay protection
    // -------------------------------------------------------------------

    function test_RevertOnNonceReuse() public {
        TrustSwapRouter.Attestation memory att = _buildAttestation(
            TrustSwapRouter.TrustTier.Verified,
            TrustSwapRouter.TrustTier.Verified,
            200
        );
        bytes memory sig = _signAttestation(att);

        // First call succeeds.
        router.gatedSwap{value: 1_000_000}(forwardedCalldata, att, sig);

        // Second call with the same (swapper, nonce) reverts.
        vm.expectRevert(
            abi.encodeWithSelector(
                TrustSwapRouter.NonceAlreadyUsed.selector,
                swapper,
                200
            )
        );
        router.gatedSwap{value: 1_000_000}(forwardedCalldata, att, sig);
    }

    function test_DistinctNoncesDoNotCollide() public {
        // Same swapper/recipient, different nonces — both must succeed.
        TrustSwapRouter.Attestation memory a = _buildAttestation(
            TrustSwapRouter.TrustTier.Verified,
            TrustSwapRouter.TrustTier.Verified,
            201
        );
        TrustSwapRouter.Attestation memory b = _buildAttestation(
            TrustSwapRouter.TrustTier.Verified,
            TrustSwapRouter.TrustTier.Verified,
            202
        );
        router.gatedSwap{value: 1_000_000}(forwardedCalldata, a, _signAttestation(a));
        router.gatedSwap{value: 1_000_000}(forwardedCalldata, b, _signAttestation(b));
    }

    // -------------------------------------------------------------------
    // Freshness
    // -------------------------------------------------------------------

    function test_RevertOnExpiredAttestation() public {
        TrustSwapRouter.Attestation memory att = _buildAttestation(
            TrustSwapRouter.TrustTier.Verified,
            TrustSwapRouter.TrustTier.Verified,
            300
        );
        bytes memory sig = _signAttestation(att);

        // Skip past `att.expiresAt` (which is `block.timestamp + 5 minutes`
        // from `_buildAttestation`).
        vm.warp(att.expiresAt + 1);

        vm.expectRevert(
            abi.encodeWithSelector(
                TrustSwapRouter.AttestationExpired.selector,
                att.expiresAt,
                att.expiresAt + 1
            )
        );
        router.gatedSwap{value: 1_000_000}(forwardedCalldata, att, sig);
    }

    function test_AtExpiryBoundarySucceeds() public {
        // `block.timestamp == expiresAt` is still valid (the contract uses
        // `>` not `>=`). One second later would revert.
        TrustSwapRouter.Attestation memory att = _buildAttestation(
            TrustSwapRouter.TrustTier.Verified,
            TrustSwapRouter.TrustTier.Verified,
            301
        );
        bytes memory sig = _signAttestation(att);
        vm.warp(att.expiresAt);
        router.gatedSwap{value: 1_000_000}(forwardedCalldata, att, sig);
    }

    // -------------------------------------------------------------------
    // Fee math — per-tier
    // -------------------------------------------------------------------

    function test_FeeDeduction_RegisteredIs100Bps() public {
        _assertFeeMath(TrustSwapRouter.TrustTier.Registered, 50_000_000, 100, 400);
    }

    function test_FeeDeduction_DiscoverableIs50Bps() public {
        _assertFeeMath(TrustSwapRouter.TrustTier.Discoverable, 500_000_000, 50, 401);
    }

    function test_FeeDeduction_VerifiedIs25Bps() public {
        _assertFeeMath(TrustSwapRouter.TrustTier.Verified, 5_000_000_000, 25, 402);
    }

    function test_FeeDeduction_FullIsZeroBps() public {
        _assertFeeMath(TrustSwapRouter.TrustTier.Full, 100 ether, 0, 403);
    }

    // -------------------------------------------------------------------
    // Universal Router forwarding
    // -------------------------------------------------------------------

    function test_UniversalRouterForwardingByteExact() public {
        bytes memory specific = hex"1234567890abcdef0011223344";
        TrustSwapRouter.Attestation memory att = _buildAttestation(
            TrustSwapRouter.TrustTier.Full,
            TrustSwapRouter.TrustTier.Full,
            500
        );
        bytes memory sig = _signAttestation(att);

        // vm.expectCall asserts the (target, value, calldata) tuple was
        // observed during the next external call. Full tier => no fee, so
        // the full msg.value goes to UR.
        uint256 amount = 1 ether;
        vm.expectCall(UNIVERSAL_ROUTER, amount, specific);
        router.gatedSwap{value: amount}(specific, att, sig);
    }

    function test_ETHValueForwarded_NetOfFee() public {
        // Verified tier: 25 bps fee. msg.value = 1 ether. UR gets
        // (1 ether - 25/10_000 * 1 ether) = 0.9975 ether.
        bytes memory specific = hex"abcdef";
        TrustSwapRouter.Attestation memory att = _buildAttestation(
            TrustSwapRouter.TrustTier.Verified,
            TrustSwapRouter.TrustTier.Verified,
            501
        );
        bytes memory sig = _signAttestation(att);

        uint256 amount = 1_000_000_000; // under verified cap of 5_000_000_000
        uint256 expectedFee = (amount * 25) / 10_000;
        uint256 expectedForward = amount - expectedFee;

        vm.expectCall(UNIVERSAL_ROUTER, expectedForward, specific);
        router.gatedSwap{value: amount}(specific, att, sig);

        assertEq(
            feeRecipient.balance,
            expectedFee,
            "fee recipient should receive exactly the bps-derived fee"
        );
    }

    // -------------------------------------------------------------------
    // Helper
    // -------------------------------------------------------------------

    function _assertFeeMath(
        TrustSwapRouter.TrustTier tier,
        uint256 amount,
        uint256 expectedBps,
        uint256 nonce
    ) internal {
        TrustSwapRouter.Attestation memory att = _buildAttestation(tier, tier, nonce);
        bytes memory sig = _signAttestation(att);

        uint256 expectedFee = (amount * expectedBps) / 10_000;

        router.gatedSwap{value: amount}(forwardedCalldata, att, sig);

        assertEq(
            feeRecipient.balance,
            expectedFee,
            "fee should equal amount * feeBps(tier) / 10_000"
        );
    }
}
