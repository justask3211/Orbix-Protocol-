// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {CreatorTokenGate} from "../../src/center/CreatorTokenGate.sol";

/// @notice Separate gate release; never redeploys the vault, pot or reward engine.
contract DeployCreatorGateV3 is Script {
    function run() external returns (CreatorTokenGate gate) {
        require(block.chainid == 46630, "Expected Robinhood testnet 46630");
        address authority = vm.envAddress("CENTER_ROOM_BIND_AUTHORITY");
        address treasury = vm.envAddress("CENTER_GATE_TREASURY");
        vm.startBroadcast();
        gate = new CreatorTokenGate(treasury, authority);
        vm.stopBroadcast();
        require(gate.bindingAuthority() == authority && gate.safetyVersion() == 3, "Gate verification failed");
        console2.log("CreatorTokenGate v3", address(gate));
        console2.log("Binding authority", authority);
    }
}
