// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/OrbixLaunchpad.sol";

contract DeployLaunchpad is Script {
    function run() external {
        address factory = 0x0229c777527CA7750b6b27b91e3F422BE70C8351;
        address router = 0x8979aE333d624b6fCf580D22ba1D0EF179aC0691;
        address treasury = msg.sender;

        vm.startBroadcast();
        new OrbixLaunchpad(factory, router, treasury, 0.001 ether, 7 days);
        vm.stopBroadcast();
    }
}
