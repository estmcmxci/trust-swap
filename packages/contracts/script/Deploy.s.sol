// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {TrustSwapRouter} from "../src/TrustSwapRouter.sol";

/// @notice TRU-57 / TRU-86 — deploy `TrustSwapRouter` to Base mainnet via
///         CREATE2.
///
/// Usage:
///   ORACLE_PUBKEY_ADDRESS=0xB70d... \
///   FEE_RECIPIENT=0xB70d... \
///   forge script script/Deploy.s.sol \
///     --rpc-url $BASE_RPC_URL \
///     --private-key $DEPLOYER_PRIVATE_KEY \
///     --broadcast \
///     --verify \
///     --etherscan-api-key $BASESCAN_API_KEY
///
/// `FEE_RECIPIENT` defaults to `ORACLE_PUBKEY_ADDRESS` if unset (oracle
/// operator collects fees, per PLAN.md § Open question 1).
///
/// CREATE2 salt is fixed at zero for v1 — gives a deterministic address
/// keyed only on (deployer, bytecode). v2 (TRU-86) bumps the bytecode by
/// adding the `address[] initialApprovals` constructor arg + ERC20-pull
/// path, so the deployed address moves to a new CREATE2 slot. Bump
/// `SALT` again only if the bytecode changes again post-deploy.
contract DeployScript is Script {
    bytes32 internal constant SALT = bytes32(0);

    /// @dev Hard-coded list of input tokens we want pre-approved at
    ///      construction so the very first ERC20-input swap doesn't pay
    ///      a one-time `setApprovals(token)` userOp. Add to this list
    ///      whenever a new input token is expected; or call
    ///      `router.setApprovals(token)` post-deploy for ad-hoc tokens.
    address internal constant WETH_BASE =
        0x4200000000000000000000000000000000000006;
    address internal constant USDC_BASE =
        0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external returns (TrustSwapRouter router) {
        address oraclePubkey = vm.envAddress("ORACLE_PUBKEY_ADDRESS");
        address feeRecipient = vm.envOr("FEE_RECIPIENT", oraclePubkey);

        address[] memory initialApprovals = new address[](2);
        initialApprovals[0] = WETH_BASE;
        initialApprovals[1] = USDC_BASE;

        // Predict the address before deploying so we can assert post-deploy
        // and the prediction can be recorded by the wrapping script for
        // session-key issuance (TRU-50).
        bytes memory creationCode = abi.encodePacked(
            type(TrustSwapRouter).creationCode,
            abi.encode(oraclePubkey, feeRecipient, initialApprovals)
        );
        address predicted = vm.computeCreate2Address(
            SALT,
            keccak256(creationCode)
        );
        console2.log("Predicted address:", predicted);
        console2.log("Oracle pubkey:    ", oraclePubkey);
        console2.log("Fee recipient:    ", feeRecipient);

        vm.startBroadcast();
        router = new TrustSwapRouter{salt: SALT}(
            oraclePubkey,
            feeRecipient,
            initialApprovals
        );
        vm.stopBroadcast();

        require(
            address(router) == predicted,
            "deploy address drifted from CREATE2 prediction"
        );

        console2.log("Deployed at:      ", address(router));
    }
}
