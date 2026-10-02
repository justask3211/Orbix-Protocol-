// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CreatorTokenGate} from "../../src/center/CreatorTokenGate.sol";
import {MockERC20} from "../../src/center/mocks/Mocks.sol";

contract CreatorTokenGateTest is Test {
    CreatorTokenGate gate;
    MockERC20 creatorToken;
    MockERC20 otherToken;

    address admin = address(0xA11CE);
    address treasury = address(0xBEEF);
    address creator = address(0xC0FFEE);
    address joiner = address(0x1234);
    address joiner2 = address(0x5678);
    bytes32 room = keccak256("room-1");

    uint256 joinerPk = 0x7011;
    uint256 constant FEE = 25e18;

    function setUp() public {
        gate = new CreatorTokenGate(treasury);
        creatorToken = new MockERC20("Creator Token", "CTK", 18);
        otherToken = new MockERC20("Other", "OTH", 18);
        creatorToken.mint(joiner, 1000e18);
        creatorToken.mint(joiner2, 1000e18);
    }

    // ------------------------------------------------------------- binding

    function test_creator_binds_token_and_fee() public {
        vm.prank(creator);
        gate.bindRoom(room, address(creatorToken), FEE);
        (address c, address t, uint256 f, bool paused) = gate.bindingOf(room);
        assertEq(c, creator);
        assertEq(t, address(creatorToken));
        assertEq(f, FEE);
        assertFalse(paused);
    }

    function test_cannot_bind_twice() public {
        vm.startPrank(creator);
        gate.bindRoom(room, address(creatorToken), FEE);
        vm.expectRevert(CreatorTokenGate.AlreadyBound.selector);
        gate.bindRoom(room, address(creatorToken), FEE);
        vm.stopPrank();
    }

    function test_cannot_bind_dead_address() public {
        // an EOA has no decimals() - sanity check must reject it
        vm.prank(creator);
        bool ok = false;
        try gate.bindRoom(room, joiner, FEE) { ok = true; } catch {}
        assertFalse(ok, "binding an EOA must fail");
    }

    function test_zero_fee_rejected() public {
        vm.prank(creator);
        vm.expectRevert(CreatorTokenGate.ZeroFee.selector);
        gate.bindRoom(room, address(creatorToken), 0);
    }

    function test_creator_can_update_binding() public {
        vm.startPrank(creator);
        gate.bindRoom(room, address(creatorToken), FEE);
        gate.updateBinding(room, address(otherToken), 5e18);
        (, address t, uint256 f,) = gate.bindingOf(room);
        assertEq(t, address(otherToken));
        assertEq(f, 5e18);
        vm.stopPrank();
    }

    function test_non_creator_cannot_update() public {
        vm.prank(creator);
        gate.bindRoom(room, address(creatorToken), FEE);
        vm.prank(joiner);
        vm.expectRevert(CreatorTokenGate.NotCreator.selector);
        gate.updateBinding(room, address(otherToken), 5e18);
    }

    // ------------------------------------------------------------- joining

    function test_joiner_pays_own_token_to_treasury() public {
        vm.prank(creator);
        gate.bindRoom(room, address(creatorToken), FEE);
        vm.startPrank(joiner);
        creatorToken.approve(address(gate), FEE);
        uint256 before = creatorToken.balanceOf(treasury);
        gate.join(room);
        vm.stopPrank();
        assertEq(creatorToken.balanceOf(treasury) - before, FEE);
        assertEq(creatorToken.balanceOf(joiner), 1000e18 - FEE);
        assertTrue(gate.hasJoined(room, joiner));
        // joiner's ORBIX-equivalent balance untouched: the gate holds no other token
        assertEq(otherToken.balanceOf(address(gate)), 0);
    }

    function test_double_join_rejected() public {
        vm.prank(creator);
        gate.bindRoom(room, address(creatorToken), FEE);
        vm.startPrank(joiner);
        creatorToken.approve(address(gate), type(uint256).max);
        gate.join(room);
        vm.expectRevert(CreatorTokenGate.AlreadyJoined.selector);
        gate.join(room);
        vm.stopPrank();
    }

    function test_join_without_allowance_reverts() public {
        vm.prank(creator);
        gate.bindRoom(room, address(creatorToken), FEE);
        vm.prank(joiner);
        vm.expectRevert();
        gate.join(room);
    }

    function test_paused_room_rejects_join() public {
        vm.startPrank(creator);
        gate.bindRoom(room, address(creatorToken), FEE);
        gate.setPaused(room, true);
        vm.stopPrank();
        vm.prank(joiner);
        vm.expectRevert(CreatorTokenGate.Paused.selector);
        gate.join(room);
    }

    function test_insufficient_balance_reverts_and_does_not_mark_joined() public {
        vm.prank(creator);
        gate.bindRoom(room, address(creatorToken), FEE);
        // joiner2 has 1000e18; drain them below the fee
        vm.prank(joiner2);
        creatorToken.transfer(admin, 1000e18 - 1e18);
        vm.startPrank(joiner2);
        creatorToken.approve(address(gate), type(uint256).max);
        vm.expectRevert();
        gate.join(room);
        vm.stopPrank();
        assertFalse(gate.hasJoined(room, joiner2), "failed join must not mark joined");
    }

    // ------------------------------------------------------------- relayed join

    function test_relayed_join_rejects_wrong_signer() public {
        vm.prank(creator);
        gate.bindRoom(room, address(creatorToken), FEE);
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
        vm.prank(creator);
        gate.bindRoom(room, address(creatorToken), FEE);
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
        // replay is refused — by the join flag first, or the one-time nonce
        bool replayed = false;
        try gate.joinRelayed(room, player, 7, sig) { replayed = true; } catch {}
        assertFalse(replayed, "replayed relay join must be refused");
        // a DIFFERENT player reusing the same nonce is refused by the nonce guard
        creatorToken.mint(joiner2, 1000e18);
        vm.prank(joiner2);
        creatorToken.approve(address(gate), FEE);
        bytes32 raw2 = keccak256(
            abi.encodePacked("ORBIX_CREATOR_JOIN_V1", address(gate), block.chainid, room, joiner2, uint256(7))
        );
        bytes32 digest2 = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", raw2));
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(0x9001, digest2);
        bool wrong = false;
        try gate.joinRelayed(room, joiner2, 7, abi.encodePacked(r2, s2, v2)) { wrong = true; } catch {}
        assertFalse(wrong, "wrong-signer relay must be refused");
    }

    // ------------------------------------------------------------- admin

    function test_admin_can_change_treasury() public {
        gate.setTreasury(address(0x9999)); // test contract is the gate admin
        vm.prank(creator);
        gate.bindRoom(room, address(creatorToken), FEE);
        vm.prank(joiner);
        creatorToken.approve(address(gate), FEE);
        uint256 before = creatorToken.balanceOf(address(0x9999));
        vm.prank(joiner);
        gate.join(room);
        assertEq(creatorToken.balanceOf(address(0x9999)) - before, FEE);
    }

    function test_non_admin_cannot_change_treasury() public {
        vm.prank(creator);
        vm.expectRevert(CreatorTokenGate.NotAdmin.selector);
        gate.setTreasury(address(0x9999));
    }
}
