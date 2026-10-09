// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {CreatorTokenGate} from "../../src/center/CreatorTokenGate.sol";
import {MockERC20,MockFeeOnTransferERC20} from "../../src/center/mocks/Mocks.sol";
contract CreatorGateAuditTest is Test {
    CreatorTokenGate gate;
    MockERC20 token;
    address creator=address(0xCA);
    uint256 constant PK=0x5157;
    function setUp() public {gate=new CreatorTokenGate(address(0xBEEF));token=new MockERC20("T","T",18);}
    function test_relay_signature_cannot_charge_mutated_fee_or_destination() public {
        address player=vm.addr(PK);token.mint(player,1000);vm.prank(player);token.approve(address(gate),1000);
        bytes32 room=keccak256("quoted-room");vm.prank(creator);gate.bindRoom(room,address(token),10,CreatorTokenGate.Payee.CreatorWallet,address(0));
        bytes32 digest=keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32",gate.joinDigest(room,player,7)));
        (uint8 v,bytes32 r,bytes32 s)=vm.sign(PK,digest);
        vm.prank(creator);gate.updateBinding(room,address(token),100,CreatorTokenGate.Payee.CreatorWallet,address(0));
        vm.expectRevert(CreatorTokenGate.BadToken.selector);gate.joinRelayed(room,player,7,abi.encodePacked(r,s,v));
        assertEq(token.balanceOf(player),1000);assertFalse(gate.hasJoined(room,player));
    }
    function test_fee_on_transfer_gate_cannot_emit_full_fee_admission() public {
        MockFeeOnTransferERC20 fee=new MockFeeOnTransferERC20();address player=vm.addr(PK);fee.mint(player,10000);
        bytes32 room=keccak256("fee-room");vm.prank(creator);gate.bindRoom(room,address(fee),10000,CreatorTokenGate.Payee.CreatorWallet,address(0));
        vm.prank(player);fee.approve(address(gate),10000);vm.prank(player);vm.expectRevert(CreatorTokenGate.BadToken.selector);gate.join(room);
        assertFalse(gate.hasJoined(room,player));assertEq(fee.balanceOf(creator),0);
    }
    function test_update_binding_cannot_replace_token_with_eoa() public {
        bytes32 room=keccak256("invalid-token");vm.prank(creator);gate.bindRoom(room,address(token),10,CreatorTokenGate.Payee.CreatorWallet,address(0));
        vm.prank(creator);vm.expectRevert(CreatorTokenGate.BadToken.selector);gate.updateBinding(room,address(0xBAD),10,CreatorTokenGate.Payee.CreatorWallet,address(0));
    }
}
