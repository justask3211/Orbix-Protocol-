// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IOFT, SendParam, MessagingFee} from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import {OptionsBuilder} from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OptionsBuilder.sol";

/// @notice Sends an OFT cross-chain. Env:
///   OFT (source OFT address), DST_EID, TO (recipient), AMOUNT (wei)
contract SendOFT is Script {
    using OptionsBuilder for bytes;

    function run() external {
        address oft = vm.envAddress("OFT");
        uint32 dstEid = uint32(vm.envUint("DST_EID"));
        address to = vm.envAddress("TO");
        uint256 amount = vm.envUint("AMOUNT");
        uint256 minAmount = (amount * 90) / 100;

        bytes memory options = OptionsBuilder.newOptions()
            .addExecutorLzReceiveOption(120000, 0);

        SendParam memory sendParam = SendParam({
            dstEid: dstEid,
            to: bytes32(uint256(uint160(to))),
            amountLD: amount,
            minAmountLD: minAmount,
            extraOptions: options,
            composeMsg: "",
            oftCmd: ""
        });

        vm.startBroadcast();
        MessagingFee memory fee = IOFT(oft).quoteSend(sendParam, false);
        console2.log("nativeFee", fee.nativeFee);
        IOFT(oft).send{value: fee.nativeFee}(sendParam, fee, msg.sender);
        vm.stopBroadcast();
    }
}
