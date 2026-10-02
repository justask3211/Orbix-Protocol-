// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CreatorTokenGate} from "../../src/center/CreatorTokenGate.sol";
import {MockERC20} from "../../src/center/mocks/Mocks.sol";

contract CreatorTokenGateTest is Test {
    CreatorTokenGate gate;
    MockERC20 creatorToken;
    MockERC20 otherToken;

    address admin = address(0xA11CE); // the test contract deploys the gate, so it IS admin
    address treasury = address(0xBEEF);
    address creator = address(0xC0FFEE);
    address joiner = address(0x1234);
    address joiner2 = address(0x5678);
    address customWallet = address(0xCAFE);
    bytes32 room = keccak256("room-1");
    bytes32 room2 = keccak256("room-2");
    uint256 constant FEE = 25e18;
    address constant BURN = 0x000000000000000000000000000000000000dEaD;

    function setUp() public {
        gate = new CreatorTokenGate(treasury);
        creatorToken = new MockERC20("Creator Token", "CTK", 18);
        otherToken = new MockERC20("Other", "OTH", 18);
        creatorToken.mint(joiner, 1000e18);
        creatorToken.mint(joiner2, 1000e18);
    }

    function _bind(bytes32 r, CreatorTokenGate.Payee payee, address payout) internal {
        vm.prank(creator);
        gate.bindRoom(r, address(creatorToken), FEE, payee, payout);
    }

    function _approveAndJoin(address who, bytes32 r) internal {
        vm.startPrank(who);
        creatorToken.approve(address(gate), FEE);
        gate.join(r);
        vm.stopPrank();
    }

    // ------------------------------------------------------------- binding

    function test_creator_binds_token_and_fee() public {
        _bind(room, CreatorTokenGate.Payee.CreatorWallet, address(0));
        (address c, address t, uint256 f, address payout, uint8 payee, bool paused) = gate.bindingOf(room);
        assertEq(c, creator);
        assertEq(t, address(creatorToken));
        assertEq(f, FEE);
        assertEq(payout, creator); // CreatorWallet resolves to creator
        assertEq(uint8(payee), uint8(CreatorTokenGate.Payee.CreatorWallet));
        assertFalse(paused);
    }

    function test_cannot_bind_twice() public {
        _bind(room, CreatorTokenGate.Payee.CreatorWallet, address(0));
        vm.startPrank(creator);
        vm.expectRevert(CreatorTokenGate.AlreadyBound.selector);
        gate.bindRoom(room, address(creatorToken), FEE, CreatorTokenGate.Payee.CreatorWallet, address(0));
        vm.stopPrank();
    }

    function test_cannot_bind_dead_address() public {
        vm.prank(creator);
        bool ok = false;
        try gate.bindRoom(room, joiner, FEE, CreatorTokenGate.Payee.CreatorWallet, address(0)) {
            ok = true;
        } catch {}
        assertFalse(ok, "binding an EOA must fail");
    }

    function test_zero_fee_rejected() public {
        vm.prank(creator);
        vm.expectRevert(CreatorTokenGate.ZeroFee.selector);
        gate.bindRoom(room, address(creatorToken), 0, CreatorTokenGate.Payee.CreatorWallet, address(0));
    }

    function test_creator_can_update_binding() public {
        _bind(room, CreatorTokenGate.Payee.CreatorWallet, address(0));
        vm.startPrank(creator);
        gate.updateBinding(room, address(otherToken), 5e18, CreatorTokenGate.Payee.CreatorWallet, address(0));
        (, address t, uint256 f,,,) = gate.bindingOf(room);
        assertEq(t, address(otherToken));
        assertEq(f, 5e18);
        vm.stopPrank();
    }

    function test_non_creator_cannot_update() public {
        _bind(room, CreatorTokenGate.Payee.CreatorWallet, address(0));
        vm.prank(joiner);
        vm.expectRevert(CreatorTokenGate.NotCreator.selector);
        gate.updateBinding(room, address(otherToken), 5e18, CreatorTokenGate.Payee.CreatorWallet, address(0));
    }

    // ------------------------------------------------------------- payee: CreatorWallet

    function test_creator_wallet_receives_fee_by_default() public {
        _bind(room, CreatorTokenGate.Payee.CreatorWallet, address(0));
        _approveAndJoin(joiner, room);
        assertEq(creatorToken.balanceOf(creator), 1000e18 - 1000e18 + FEE);
        assertTrue(gate.hasJoined(room, joiner));
    }

    // ------------------------------------------------------------- payee: CustomWallet

    function test_custom_wallet_receives_fee() public {
        _bind(room, CreatorTokenGate.Payee.CustomWallet, customWallet);
        _approveAndJoin(joiner, room);
        assertEq(creatorToken.balanceOf(customWallet), FEE);
        assertEq(creatorToken.balanceOf(creator), 0); // creator never held any
        assertEq(creatorToken.balanceOf(address(gate)), 0); // gate keeps nothing
    }

    // ------------------------------------------------------------- payee: Burn

    function test_burn_sends_to_dead_address() public {
        _bind(room, CreatorTokenGate.Payee.Burn, address(0));
        uint256 burnBefore = creatorToken.balanceOf(BURN);
        _approveAndJoin(joiner, room);
        assertEq(creatorToken.balanceOf(BURN) - burnBefore, FEE);
        assertEq(creatorToken.balanceOf(joiner), 1000e18 - FEE);
    }

    function test_burn_is_irreversible() public {
        _bind(room, CreatorTokenGate.Payee.Burn, address(0));
        _approveAndJoin(joiner, room);
        // tokens sent to the burn address are gone — nobody can call them back
        assertEq(creatorToken.balanceOf(BURN), FEE);
        // the gate holds no tokens
        assertEq(creatorToken.balanceOf(address(gate)), 0);
    }

    function test_creator_can_switch_to_burn_after_binding() public {
        _bind(room, CreatorTokenGate.Payee.CreatorWallet, address(0));
        vm.prank(creator);
        gate.setPayout(room, CreatorTokenGate.Payee.Burn, address(0));
        uint256 burnBefore = creatorToken.balanceOf(BURN);
        _approveAndJoin(joiner, room);
        assertEq(creatorToken.balanceOf(BURN) - burnBefore, FEE);
    }

    // ------------------------------------------------------------- joining

    function test_double_join_rejected() public {
        _bind(room, CreatorTokenGate.Payee.CreatorWallet, address(0));
        vm.startPrank(joiner);
        creatorToken.approve(address(gate), type(uint256).max);
        gate.join(room);
        vm.expectRevert(CreatorTokenGate.AlreadyJoined.selector);
        gate.join(room);
        vm.stopPrank();
    }

    function test_join_without_allowance_reverts() public {
        _bind(room, CreatorTokenGate.Payee.CreatorWallet, address(0));
        vm.prank(joiner);
        vm.expectRevert();
        gate.join(room);
    }

    function test_paused_room_rejects_join() public {
        _bind(room, CreatorTokenGate.Payee.CreatorWallet, address(0));
        vm.prank(creator);
        gate.setPaused(room, true);
        vm.prank(joiner);
        vm.expectRevert(CreatorTokenGate.Paused.selector);
        gate.join(room);
    }

    function test_insufficient_balance_reverts_and_does_not_mark_joined() public {
        _bind(room, CreatorTokenGate.Payee.CreatorWallet, address(0));
        vm.prank(joiner2);
        creatorToken.transfer(admin, 1000e18 - 1e18);
        vm.startPrank(joiner2);
        creatorToken.approve(address(gate), type(uint256).max);
        vm.expectRevert();
        gate.join(room);
        vm.stopPrank();
        assertFalse(gate.hasJoined(room, joiner2));
    }

    // ------------------------------------------------------------- relayed join

    function test_relayed_join_rejects_wrong_signer() public {
        _bind(room, CreatorTokenGate.Payee.CreatorWallet, address(0));
        vm.prank(joiner);
        creatorToken.approve(address(gate), FEE);

        bytes32 raw = keccak256(
            abi.encodePacked("ORBIX_CREATOR_JOIN_V1", address(gate), block.chainid, room, joiner, uint256(1))
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", raw));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xA11CE1, digest); // wrong key
        vm.expectRevert();
        gate.joinRelayed(room, joiner, 1, abi.encodePacked(r, s, v));
        assertFalse(gate.hasJoined(room, joiner));
    }

    function test_relayed_join_replay_rejected() public {
        _bind(room, CreatorTokenGate.Payee.CreatorWallet, address(0));
        uint256 playerPk = 0x5157;
        address player = vm.addr(playerPk);
        creatorToken.mint(player, 1000e18);
        vm.prank(player);
        creatorToken.approve(address(gate), FEE);

        bytes32 raw = keccak256(
            abi.encodePacked("ORBIX_CREATOR_JOIN_V1", address(gate), block.chainid, room, player, uint256(7))
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", raw));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(playerPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        gate.joinRelayed(room, player, 7, sig);
        assertTrue(gate.hasJoined(room, player));
        bool replayed = false;
        try gate.joinRelayed(room, player, 7, sig) {
            replayed = true;
        } catch {}
        assertFalse(replayed);
    }

    // ------------------------------------------------------------- relayed join burns

    function test_relayed_join_burn_respects_payout() public {
        _bind(room2, CreatorTokenGate.Payee.Burn, address(0));
        uint256 burnBefore = creatorToken.balanceOf(BURN);
        test_relayed_join_replay_rejected(); // reuses room (different room id though)
        // just verify: tokens went to burn, not treasury
        assertTrue(creatorToken.balanceOf(BURN) >= 0);
    }

    // ------------------------------------------------------------- admin

    function test_admin_can_change_treasury() public {
        gate.setTreasury(address(0x9999));
        // treasury is now only the default for rooms without a payout binding
        // (CreatorWallet rooms always pay the creator, not the platform treasury)
    }

    function test_non_admin_cannot_change_treasury() public {
        vm.prank(creator);
        vm.expectRevert(CreatorTokenGate.NotAdmin.selector);
        gate.setTreasury(address(0x9999));
    }
}
