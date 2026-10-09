// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {CreatorTokenGate} from "../../src/center/CreatorTokenGate.sol";
import {MockERC20} from "../../src/center/mocks/Mocks.sol";

contract MutatingGateToken is MockERC20 {
    CreatorTokenGate gate;
    bytes32 room;
    bool public callbackBlocked;
    constructor(CreatorTokenGate target) MockERC20("Callback", "CALL", 18) { gate=target; }
    function bind(bytes32 key,uint256 deadline,bytes memory proof) external {
        room=key;gate.bindRoomAuthorized(key,address(this),10,CreatorTokenGate.Payee.CreatorWallet,address(0),deadline,proof);
    }
    function transferFrom(address from,address to,uint256 amount) public override returns(bool) {
        bool ok=super.transferFrom(from,to,amount);
        try gate.setPayout(room,CreatorTokenGate.Payee.Burn,address(0)) {} catch { callbackBlocked=true; }
        return ok;
    }
}

contract CreatorGateFeaturesTest is Test {
    CreatorTokenGate gate;
    MockERC20 token;
    uint256 constant AUTH_PK=0xB17D;
    uint256 constant PLAYER_PK=0x5157;
    address creator=address(0xCA);
    address player;
    bytes32 room=keccak256("server-room");
    function setUp() public {
        vm.warp(1000);player=vm.addr(PLAYER_PK);
        gate=new CreatorTokenGate(address(0xBEEF),vm.addr(AUTH_PK));
        token=new MockERC20("T","T",18);token.mint(player,1000);
        vm.prank(player);token.approve(address(gate),1000);
    }
    function signature(uint256 pk, bytes32 raw) internal returns(bytes memory) {
        (uint8 v,bytes32 r,bytes32 s)=vm.sign(pk,keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32",raw)));
        return abi.encodePacked(r,s,v);
    }
    function authorization(bytes32 r,address host,uint256 deadline) internal returns(bytes memory) {
        return signature(AUTH_PK,gate.roomBindingDigest(r,host,deadline));
    }
    function bind(CreatorTokenGate.Payee payee,address payout) internal {
        bytes memory proof=authorization(room,creator,2000);
        vm.prank(creator);gate.bindRoomAuthorized(room,address(token),10,payee,payout,2000,proof);
    }
    function test_squatter_cannot_bind_known_room_or_steal_creator_authorization() public {
        bytes memory proof=authorization(room,creator,2000);
        vm.prank(player);vm.expectRevert(CreatorTokenGate.NotCreator.selector);
        gate.bindRoom(room,address(token),10,CreatorTokenGate.Payee.CreatorWallet,address(0));
        vm.prank(player);vm.expectRevert(CreatorTokenGate.BadRoomAuthorization.selector);
        gate.bindRoomAuthorized(room,address(token),10,CreatorTokenGate.Payee.CreatorWallet,address(0),2000,proof);
        // A front runner may relay registration, but only pins the intended creator.
        vm.prank(player);gate.registerRoomCreator(room,creator,2000,proof);
        vm.prank(player);vm.expectRevert(CreatorTokenGate.NotCreator.selector);
        gate.bindRoom(room,address(token),10,CreatorTokenGate.Payee.CreatorWallet,address(0));
        vm.prank(creator);gate.bindRoom(room,address(token),10,CreatorTokenGate.Payee.CreatorWallet,address(0));
        (address host,,,,,)=gate.bindingOf(room);assertEq(host,creator);
    }
    function test_room_authorization_cannot_cross_room_gate_chain_or_deadline() public {
        bytes memory proof=authorization(room,creator,2000);
        vm.expectRevert(CreatorTokenGate.BadRoomAuthorization.selector);gate.registerRoomCreator(bytes32(uint256(1)),creator,2000,proof);
        CreatorTokenGate other=new CreatorTokenGate(address(0xBEEF),vm.addr(AUTH_PK));
        vm.expectRevert(CreatorTokenGate.BadRoomAuthorization.selector);other.registerRoomCreator(room,creator,2000,proof);
        vm.chainId(block.chainid+1);
        vm.expectRevert(CreatorTokenGate.BadRoomAuthorization.selector);gate.registerRoomCreator(room,creator,2000,proof);
        vm.warp(2001);
        vm.expectRevert(CreatorTokenGate.AuthorizationExpired.selector);gate.registerRoomCreator(room,creator,2000,proof);
    }
    function test_even_authority_cannot_replace_pinned_creator() public {
        bind(CreatorTokenGate.Payee.CreatorWallet,address(0));
        bytes memory alternate=authorization(room,player,2000);
        vm.expectRevert(CreatorTokenGate.NotCreator.selector);gate.registerRoomCreator(room,player,2000,alternate);
        vm.prank(vm.addr(AUTH_PK));vm.expectRevert(CreatorTokenGate.NotCreator.selector);gate.setPayout(room,CreatorTokenGate.Payee.Burn,address(0));
        assertEq(gate.roomCreators(room),creator);
    }
    function test_feature_creator_updates_quote_and_new_signature_still_joins() public {
        bind(CreatorTokenGate.Payee.CreatorWallet,address(0));
        vm.startPrank(creator);gate.updateBinding(room,address(token),15,CreatorTokenGate.Payee.CustomWallet,address(0xCAFE));
        gate.setPaused(room,true);gate.setPaused(room,false);vm.stopPrank();
        bytes memory quote=signature(PLAYER_PK,gate.joinDigest(room,player,9));
        vm.prank(player);gate.joinQuoted(room,9,quote);
        assertEq(token.balanceOf(address(0xCAFE)),15);assertTrue(gate.hasJoined(room,player));
        assertTrue(gate.relayNonceUsed(room,player,9));assertEq(token.balanceOf(address(gate)),0);
    }
    function testFuzz_quoted_wallet_payment_rejects_every_mutable_field(uint8 field) public {
        field=uint8(bound(field,0,3));bind(CreatorTokenGate.Payee.CreatorWallet,address(0));
        bytes memory quote=signature(PLAYER_PK,gate.joinDigest(room,player,9));
        vm.startPrank(creator);
        if(field==0)gate.updateBinding(room,address(token),11,CreatorTokenGate.Payee.CreatorWallet,address(0));
        else if(field==1){MockERC20 other=new MockERC20("O","O",18);gate.updateBinding(room,address(other),10,CreatorTokenGate.Payee.CreatorWallet,address(0));}
        else if(field==2)gate.setPayout(room,CreatorTokenGate.Payee.CustomWallet,address(0xCAFE));
        else gate.setPayout(room,CreatorTokenGate.Payee.CustomWallet,creator); // Same destination, different payee enum.
        vm.stopPrank();
        vm.prank(player);vm.expectRevert(CreatorTokenGate.BadToken.selector);gate.joinQuoted(room,9,quote);
        assertEq(token.balanceOf(player),1000);assertFalse(gate.hasJoined(room,player));assertFalse(gate.relayNonceUsed(room,player,9));
    }
    function test_quoted_payment_binds_player_nonce_and_room_and_rejects_replay() public {
        bind(CreatorTokenGate.Payee.Burn,address(0));
        bytes memory quote=signature(PLAYER_PK,gate.joinDigest(room,player,9));
        vm.prank(player);vm.expectRevert(CreatorTokenGate.BadToken.selector);gate.joinQuoted(room,10,quote);
        vm.prank(creator);vm.expectRevert(CreatorTokenGate.BadToken.selector);gate.joinQuoted(room,9,quote);
        bytes32 second=keccak256("second");bytes memory proof=authorization(second,creator,2000);
        vm.prank(creator);gate.bindRoomAuthorized(second,address(token),10,CreatorTokenGate.Payee.Burn,address(0),2000,proof);
        vm.prank(player);vm.expectRevert(CreatorTokenGate.BadToken.selector);gate.joinQuoted(second,9,quote);
        vm.prank(player);gate.joinQuoted(room,9,quote);assertEq(token.balanceOf(gate.BURN_ADDRESS()),10);
        vm.prank(player);vm.expectRevert(CreatorTokenGate.AlreadyJoined.selector);gate.joinQuoted(room,9,quote);
        vm.expectRevert(CreatorTokenGate.AlreadyJoined.selector);gate.joinRelayed(room,player,9,quote);
    }
    function test_feature_legacy_direct_join_abi_remains_usable() public {
        bind(CreatorTokenGate.Payee.CreatorWallet,address(0));vm.prank(player);gate.join(room);
        assertEq(token.balanceOf(creator),10);assertEq(gate.safetyVersion(),3);
    }
    function test_payout_event_reports_actual_old_destination() public {
        bind(CreatorTokenGate.Payee.CreatorWallet,address(0));
        vm.recordLogs();vm.prank(creator);gate.setPayout(room,CreatorTokenGate.Payee.CustomWallet,address(0xCAFE));
        Vm.Log[] memory logs=vm.getRecordedLogs();
        assertEq(logs[0].topics[2],bytes32(uint256(uint160(creator))));
        assertEq(logs[0].topics[3],bytes32(uint256(uint160(address(0xCAFE)))));
    }

    function test_token_callback_cannot_change_signed_quote_during_payment() public {
        MutatingGateToken callback=new MutatingGateToken(gate);
        bytes memory proof=authorization(room,address(callback),2000);callback.bind(room,2000,proof);
        callback.mint(player,10);vm.prank(player);callback.approve(address(gate),10);
        bytes memory quote=signature(PLAYER_PK,gate.joinDigest(room,player,9));
        vm.prank(player);gate.joinQuoted(room,9,quote);
        (,,,address payout,uint8 payee,)=gate.bindingOf(room);
        assertTrue(callback.callbackBlocked());assertEq(payout,address(callback));assertEq(payee,0);
        assertEq(callback.balanceOf(address(callback)),10);assertTrue(gate.hasJoined(room,player));
    }
}
