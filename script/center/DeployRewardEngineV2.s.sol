// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {RewardEngine} from "../../src/center/RewardEngine.sol";

/// @notice Deploy exactly one immutable engine for every asset and claim mode.
/// Dry-run by default. Hermes supplies --broadcast only during the release.
contract DeployRewardEngineV2 is Script {
    function run() external returns (RewardEngine engine) {
        require(block.chainid == 46630, "Expected Robinhood testnet 46630");
        address authority = vm.envAddress("CENTER_REWARD_AUTHORITY");
        require(authority != address(0), "Zero authority");
        vm.startBroadcast();
        engine = new RewardEngine(authority);
        vm.stopBroadcast();
        require(engine.authority() == authority && engine.safetyVersion() == 2 && engine.poolCount() == 0,
            "Deployment verification failed");
        console2.log("RewardEngine v2", address(engine));
        console2.log("Authority", authority);
        console2.log("Chain", block.chainid);
    }
}
