// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TrustSwapRouter} from "../src/TrustSwapRouter.sol";
import {TrustSwapRouterBaseTest} from "./TrustSwapRouterBase.t.sol";

/// @notice TRU-53 — tier-floor revert + per-tier cap enforcement +
///         stricter-wins join + full-tier unbounded behavior.
contract TrustSwapRouterTiersTest is TrustSwapRouterBaseTest {
    // -------------------------------------------------------------------
    // Tier floor — None on either side reverts
    // -------------------------------------------------------------------

    function test_RevertWhen_SwapperTierNone() public {
        TrustSwapRouter.Attestation memory att = _buildAttestation(
            TrustSwapRouter.TrustTier.None,
            TrustSwapRouter.TrustTier.Full,
            1
        );
        bytes memory sig = _signAttestation(att);
        vm.expectRevert(TrustSwapRouter.TierNone.selector);
        router.gatedSwap{value: 1 ether}(forwardedCalldata, att, sig);
    }

    function test_RevertWhen_RecipientTierNone() public {
        TrustSwapRouter.Attestation memory att = _buildAttestation(
            TrustSwapRouter.TrustTier.Full,
            TrustSwapRouter.TrustTier.None,
            2
        );
        bytes memory sig = _signAttestation(att);
        vm.expectRevert(TrustSwapRouter.TierNone.selector);
        router.gatedSwap{value: 1 ether}(forwardedCalldata, att, sig);
    }

    function test_RevertWhen_BothTiersNone() public {
        TrustSwapRouter.Attestation memory att = _buildAttestation(
            TrustSwapRouter.TrustTier.None,
            TrustSwapRouter.TrustTier.None,
            3
        );
        bytes memory sig = _signAttestation(att);
        vm.expectRevert(TrustSwapRouter.TierNone.selector);
        router.gatedSwap{value: 1 ether}(forwardedCalldata, att, sig);
    }

    // -------------------------------------------------------------------
    // Per-tier caps — at-cap succeeds, over-cap reverts
    // -------------------------------------------------------------------

    function test_RegisteredCap_AtCapSucceeds() public {
        // registered cap = 50_000_000 wei
        _swapAtSymmetricTier(TrustSwapRouter.TrustTier.Registered, 50_000_000, 10);
    }

    function test_RegisteredCap_OverCapReverts() public {
        TrustSwapRouter.Attestation memory att = _buildAttestation(
            TrustSwapRouter.TrustTier.Registered,
            TrustSwapRouter.TrustTier.Registered,
            11
        );
        bytes memory sig = _signAttestation(att);
        vm.expectRevert(
            abi.encodeWithSelector(
                TrustSwapRouter.AmountExceedsCap.selector,
                50_000_001,
                50_000_000
            )
        );
        router.gatedSwap{value: 50_000_001}(forwardedCalldata, att, sig);
    }

    function test_DiscoverableCap_AtCapSucceeds() public {
        _swapAtSymmetricTier(TrustSwapRouter.TrustTier.Discoverable, 500_000_000, 20);
    }

    function test_DiscoverableCap_OverCapReverts() public {
        TrustSwapRouter.Attestation memory att = _buildAttestation(
            TrustSwapRouter.TrustTier.Discoverable,
            TrustSwapRouter.TrustTier.Discoverable,
            21
        );
        bytes memory sig = _signAttestation(att);
        vm.expectRevert(
            abi.encodeWithSelector(
                TrustSwapRouter.AmountExceedsCap.selector,
                500_000_001,
                500_000_000
            )
        );
        router.gatedSwap{value: 500_000_001}(forwardedCalldata, att, sig);
    }

    function test_VerifiedCap_AtCapSucceeds() public {
        _swapAtSymmetricTier(TrustSwapRouter.TrustTier.Verified, 5_000_000_000, 30);
    }

    function test_VerifiedCap_OverCapReverts() public {
        TrustSwapRouter.Attestation memory att = _buildAttestation(
            TrustSwapRouter.TrustTier.Verified,
            TrustSwapRouter.TrustTier.Verified,
            31
        );
        bytes memory sig = _signAttestation(att);
        vm.expectRevert(
            abi.encodeWithSelector(
                TrustSwapRouter.AmountExceedsCap.selector,
                5_000_000_001,
                5_000_000_000
            )
        );
        router.gatedSwap{value: 5_000_000_001}(forwardedCalldata, att, sig);
    }

    function test_FullTier_Unbounded() public {
        // Full tier returns type(uint256).max — any sane test value succeeds.
        // We use 100 ether to confirm the cap doesn't fire and the call
        // forwards through to the mocked UR.
        _swapAtSymmetricTier(TrustSwapRouter.TrustTier.Full, 100 ether, 40);
    }

    // -------------------------------------------------------------------
    // Stricter-wins join — asymmetric tiers
    // -------------------------------------------------------------------

    function test_StricterWinsJoin_FullSwapper_RegisteredRecipient() public {
        // Swapper full (unbounded), recipient registered ($50). Effective
        // tier = registered. 51_000_000 wei must revert as over-cap.
        TrustSwapRouter.Attestation memory att = _buildAttestation(
            TrustSwapRouter.TrustTier.Full,
            TrustSwapRouter.TrustTier.Registered,
            50
        );
        bytes memory sig = _signAttestation(att);
        vm.expectRevert(
            abi.encodeWithSelector(
                TrustSwapRouter.AmountExceedsCap.selector,
                51_000_000,
                50_000_000
            )
        );
        router.gatedSwap{value: 51_000_000}(forwardedCalldata, att, sig);
    }

    function test_StricterWinsJoin_VerifiedSwapper_DiscoverableRecipient()
        public
    {
        // Swapper verified ($5k), recipient discoverable ($500). Effective
        // tier = discoverable; cap = 500_000_000. 1_000_000_000 reverts.
        TrustSwapRouter.Attestation memory att = _buildAttestation(
            TrustSwapRouter.TrustTier.Verified,
            TrustSwapRouter.TrustTier.Discoverable,
            51
        );
        bytes memory sig = _signAttestation(att);
        vm.expectRevert(
            abi.encodeWithSelector(
                TrustSwapRouter.AmountExceedsCap.selector,
                1_000_000_000,
                500_000_000
            )
        );
        router.gatedSwap{value: 1_000_000_000}(forwardedCalldata, att, sig);
    }

    function test_StricterWinsJoin_AtJoinedCapSucceeds() public {
        // Swapper full, recipient verified. Effective = verified ($5k).
        // 5_000_000_000 (at cap) succeeds — proves the join isn't using
        // either side's full cap.
        TrustSwapRouter.Attestation memory att = _buildAttestation(
            TrustSwapRouter.TrustTier.Full,
            TrustSwapRouter.TrustTier.Verified,
            52
        );
        bytes memory sig = _signAttestation(att);
        // Verified fee is 25 bps — emit assertion includes the exact fee.
        vm.expectEmit(true, true, true, true, address(router));
        emit TrustSwapRouter.GatedSwap(
            keccak256(abi.encode(att)),
            swapper,
            recipient,
            TrustSwapRouter.TrustTier.Verified,
            5_000_000_000,
            (5_000_000_000 * 25) / 10_000
        );
        router.gatedSwap{value: 5_000_000_000}(forwardedCalldata, att, sig);
    }

    // -------------------------------------------------------------------
    // Helper — symmetric-tier success path with full event match
    // -------------------------------------------------------------------

    function _swapAtSymmetricTier(
        TrustSwapRouter.TrustTier tier,
        uint256 amount,
        uint256 nonce
    ) internal {
        TrustSwapRouter.Attestation memory att = _buildAttestation(
            tier,
            tier,
            nonce
        );
        bytes memory sig = _signAttestation(att);

        uint256 expectedFee = (amount * _expectedFeeBps(tier)) / 10_000;

        vm.expectEmit(true, true, true, true, address(router));
        emit TrustSwapRouter.GatedSwap(
            keccak256(abi.encode(att)),
            swapper,
            recipient,
            tier,
            amount,
            expectedFee
        );
        router.gatedSwap{value: amount}(forwardedCalldata, att, sig);

        // Fee landed at FEE_RECIPIENT.
        assertEq(feeRecipient.balance, expectedFee, "fee recipient balance");
    }

    function _expectedFeeBps(TrustSwapRouter.TrustTier tier)
        internal
        pure
        returns (uint256)
    {
        if (tier == TrustSwapRouter.TrustTier.Full) return 0;
        if (tier == TrustSwapRouter.TrustTier.Verified) return 25;
        if (tier == TrustSwapRouter.TrustTier.Discoverable) return 50;
        if (tier == TrustSwapRouter.TrustTier.Registered) return 100;
        revert("unreachable");
    }
}
