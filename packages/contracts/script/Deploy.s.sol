// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {TrustSwapRouter} from "../src/TrustSwapRouter.sol";

/// @notice TRU-57 — deploy `TrustSwapRouter` to Base mainnet via CREATE2.
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
/// CREATE2 salt is fixed at zero — gives a deterministic address keyed only
/// on (deployer, bytecode). Bump the salt if the bytecode ever changes
/// post-deploy in a way that requires a fresh address.
contract DeployScript is Script {
    bytes32 internal constant SALT = bytes32(0);

    function run() external returns (TrustSwapRouter router) {
        address oraclePubkey = vm.envAddress("ORACLE_PUBKEY_ADDRESS");
        address feeRecipient = vm.envOr("FEE_RECIPIENT", oraclePubkey);

        // Predict the address before deploying so we can assert post-deploy
        // and the prediction can be recorded by the wrapping script for
        // session-key issuance (TRU-50).
        bytes memory creationCode = abi.encodePacked(
            type(TrustSwapRouter).creationCode,
            abi.encode(oraclePubkey, feeRecipient)
        );
        address predicted = vm.computeCreate2Address(
            SALT,
            keccak256(creationCode)
        );
        console2.log("Predicted address:", predicted);
        console2.log("Oracle pubkey:    ", oraclePubkey);
        console2.log("Fee recipient:    ", feeRecipient);

        vm.startBroadcast();
        router = new TrustSwapRouter{salt: SALT}(oraclePubkey, feeRecipient);
        vm.stopBroadcast();

        require(
            address(router) == predicted,
            "deploy address drifted from CREATE2 prediction"
        );

        console2.log("Deployed at:      ", address(router));
    }
}
