// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TrustSwapRouter} from "../src/TrustSwapRouter.sol";
import {TrustSwapRouterBaseTest} from "./TrustSwapRouterBase.t.sol";

/// @notice TRU-86 — ERC20-input path. Verifies the router pulls
///         `amountIn` of `tokenIn` from `payer` before forwarding to UR,
///         enforces the `payer == att.swapper` binding, and refuses to
///         pull when `payer == address(0)` (preserving the v1 ETH path).
contract TrustSwapRouterErc20Test is TrustSwapRouterBaseTest {
    /// @notice Minimal mintable ERC20 mock — just enough to satisfy
    ///         transferFrom + approve. Deployed in-test, so the router's
    ///         lazy `setApprovals(token)` doesn't need real WETH/USDC at
    ///         the canonical Base addresses.
    MockERC20 internal token;

    function setUp() public override {
        super.setUp();
        token = new MockERC20();
        // Etch dummy bytecode at Permit2's canonical address so the
        // router's `IERC20.approve(PERMIT2, …)` and
        // `IPermit2.approve(...)` calls don't revert against
        // address-with-no-code in the test environment.
        vm.etch(router.PERMIT2(), address(new MockPermit2()).code);
    }

    function test_PullsErc20FromPayerAndForwardsToUR() public {
        uint256 amountIn = 1_000;
        token.mint(swapper, amountIn);
        // Swapper grants the router an exact-amount approval. In
        // production the kernel uses `IERC20.approve(router, max)` once
        // during bootstrap, so a tighter test here exercises the
        // narrow-allowance path too.
        vm.prank(swapper);
        token.approve(address(router), amountIn);

        // Approvals from router → Permit2 → UR happen via setApprovals;
        // call once before the swap so the path that production deploys
        // run via `initialApprovals` is exercised here too.
        router.setApprovals(address(token));
        assertTrue(router.approvalsReady(address(token)), "approvalsReady");

        bytes memory urCalldata = hex"deadbeef";
        TrustSwapRouter.Attestation memory att = _buildAttestationWithCalldata(
            TrustSwapRouter.TrustTier.Full,
            TrustSwapRouter.TrustTier.Full,
            900,
            urCalldata
        );
        bytes memory sig = _signAttestation(att);

        // No msg.value — ERC20-input swaps pass value=0 and the router
        // forwards 0 to UR (mock UR ignores value).
        vm.expectCall(UNIVERSAL_ROUTER, 0, urCalldata);
        router.gatedSwap(swapper, address(token), amountIn, urCalldata, att, sig);

        // Tokens moved from swapper to router. (UR is mocked and doesn't
        // pull, so the balance lingers in the router for this test.)
        assertEq(token.balanceOf(swapper), 0, "swapper drained");
        assertEq(
            token.balanceOf(address(router)),
            amountIn,
            "router holds pulled tokens"
        );
    }

    function test_RevertWhen_PayerIsNotAttestedSwapper() public {
        uint256 amountIn = 500;
        address impostor = address(0xC0FFEE);
        token.mint(impostor, amountIn);
        vm.prank(impostor);
        token.approve(address(router), amountIn);
        router.setApprovals(address(token));

        bytes memory urCalldata = hex"abcd";
        // Attestation is over `swapper` (default fixture) — but the
        // caller passes `impostor` as payer. Router rejects.
        TrustSwapRouter.Attestation memory att = _buildAttestationWithCalldata(
            TrustSwapRouter.TrustTier.Full,
            TrustSwapRouter.TrustTier.Full,
            901,
            urCalldata
        );
        bytes memory sig = _signAttestation(att);

        vm.expectRevert(
            abi.encodeWithSelector(
                TrustSwapRouter.PayerNotAttestedSwapper.selector,
                impostor,
                swapper
            )
        );
        router.gatedSwap(impostor, address(token), amountIn, urCalldata, att, sig);
    }

    function test_PayerZero_NoPullEvenIfAmountInNonzero() public {
        // payer=0 path is the v1 ETH-input convention. Even when amountIn
        // is non-zero (caller error), the router skips the pull rather
        // than reverting — preserves v1 behavior.
        bytes memory urCalldata = hex"cafe";
        TrustSwapRouter.Attestation memory att = _buildAttestationWithCalldata(
            TrustSwapRouter.TrustTier.Full,
            TrustSwapRouter.TrustTier.Full,
            902,
            urCalldata
        );
        bytes memory sig = _signAttestation(att);

        vm.expectCall(UNIVERSAL_ROUTER, 0, urCalldata);
        router.gatedSwap(address(0), address(token), 999, urCalldata, att, sig);
        // No tokens moved.
        assertEq(token.balanceOf(address(router)), 0, "no pull on payer=0");
    }

    function test_AmountZero_NoPullEvenIfPayerNonzero() public {
        // Symmetry of the previous test — `amountIn == 0` means "nothing
        // to pull", regardless of payer.
        bytes memory urCalldata = hex"feed";
        TrustSwapRouter.Attestation memory att = _buildAttestationWithCalldata(
            TrustSwapRouter.TrustTier.Full,
            TrustSwapRouter.TrustTier.Full,
            903,
            urCalldata
        );
        bytes memory sig = _signAttestation(att);

        router.gatedSwap(swapper, address(token), 0, urCalldata, att, sig);
        assertEq(token.balanceOf(address(router)), 0, "no pull on amount=0");
    }
}

contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amt) external {
        balanceOf[to] += amt;
    }

    function approve(address spender, uint256 amt) external returns (bool) {
        allowance[msg.sender][spender] = amt;
        return true;
    }

    function transferFrom(address from, address to, uint256 amt)
        external
        returns (bool)
    {
        uint256 a = allowance[from][msg.sender];
        require(a >= amt, "ERC20: insufficient allowance");
        if (a != type(uint256).max) {
            allowance[from][msg.sender] = a - amt;
        }
        require(balanceOf[from] >= amt, "ERC20: insufficient balance");
        balanceOf[from] -= amt;
        balanceOf[to] += amt;
        return true;
    }

    function transfer(address to, uint256 amt) external returns (bool) {
        require(balanceOf[msg.sender] >= amt, "ERC20: insufficient balance");
        balanceOf[msg.sender] -= amt;
        balanceOf[to] += amt;
        return true;
    }
}

/// @notice Stub that just accepts `approve(token, spender, amount, expiration)`
///         so the router's setApprovals path doesn't revert in tests. We
///         don't model Permit2's allowance bookkeeping — UR is mocked too.
contract MockPermit2 {
    event Approve(address token, address spender, uint160 amount, uint48 expiration);

    function approve(
        address token,
        address spender,
        uint160 amount,
        uint48 expiration
    ) external {
        emit Approve(token, spender, amount, expiration);
    }
}
