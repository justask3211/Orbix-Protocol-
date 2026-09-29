// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {OrbixOFT, OrbixOFTAdapter} from "../src/OrbixOFT.sol";

contract DeployOFT is Script {
    // LayerZero V2 testnet endpoints (both share the same EndpointV2 address)
    address constant SEP_ENDPOINT = 0x6EDCE65403992e310A62460808c4b910D972f10f; // eid 40161
    address constant ARBSEP_ENDPOINT = 0x6EDCE65403992e310A62460808c4b910D972f10f; // eid 40231

    function run() external {
        string memory mode = vm.envOr("OFT_MODE", string("oft"));
        address endpoint = vm.envAddress("OFT_ENDPOINT");
        address owner = msg.sender;

        vm.startBroadcast();
        if (keccak256(bytes(mode)) == keccak256(bytes("adapter"))) {
            address token = vm.envAddress("OFT_INNER_TOKEN");
            new OrbixOFTAdapter(token, endpoint, owner);
        } else {
            new OrbixOFT("Orbix Omnichain", "xORBIX", endpoint, owner, 1_000_000 ether);
        }
        vm.stopBroadcast();
    }
}
