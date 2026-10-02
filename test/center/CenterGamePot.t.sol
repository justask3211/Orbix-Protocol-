// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CenterGamePot} from "../../src/center/CenterGamePot.sol";
import {MockERC20, MockERC721} from "../../src/center/mocks/Mocks.sol";

contract CenterGamePotTest is Test {
    CenterGamePot pot;
    MockERC20 token;
    MockERC721 nft;
    uint256 constant AUTH_PK = 0xA11CE;
    address authority;
    address treasury = address(0xBEEF);
    address creator = address(0xC0FFEE);
    address player = address(0xA11CE1);
    address winner = address(0xA11CE2);
    bytes32 room = keccak256("room");

    function setUp() public {
        authority = vm.addr(AUTH_PK);
        pot = new CenterGamePot(authority, treasury, 0);
        token = new MockERC20("Test", "T", 18);
        nft = new MockERC721();
        token.mint(creator, 1000e18);
        token.mint(player, 1000e18);
        vm.prank(creator);
        token.approve(address(pot), type(uint256).max);
        vm.prank(player);
        token.approve(address(pot), type(uint256).max);
        vm.warp(1000);
    }

    function _sig(bytes32 digest) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(AUTH_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    function _open(CenterGamePot.Mode mode, uint16 share) internal {
        vm.prank(creator);
        pot.openRoom(room, creator, share, address(token), 10e18, mode, uint64(block.timestamp + 1000));
    }

    function test_settle_rejects_unsigned_signature() public {
        _open(CenterGamePot.Mode.Manual, 0);
        vm.prank(player);
        pot.enter(room);
        address[] memory winners = new address[](1);
        winners[0] = winner;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 10e18;
        vm.expectRevert(CenterGamePot.NotAuthority.selector);
        pot.settle(room, winners, amounts, new address[](0), new uint256[](0), "");
    }

    function test_authority_must_sign_settlement_payload() public {
        _open(CenterGamePot.Mode.Manual, 0);
        vm.prank(player);
        pot.enter(room);
        address[] memory winners = new address[](1);
        winners[0] = winner;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1e18;
        address[] memory rw = new address[](0);
        uint256[] memory ri = new uint256[](0);
        bytes32 wrong = keccak256(abi.encodePacked("wrong-room", winners, amounts));
        vm.expectRevert(CenterGamePot.BadSignature.selector);
        pot.settle(room, winners, amounts, rw, ri, _sig(wrong));
    }

    function test_signed_settlement_rejects_payouts_over_net_pot() public {
        _open(CenterGamePot.Mode.Manual, 0);
        vm.prank(player);
        pot.enter(room);
        address[] memory winners = new address[](1);
        winners[0] = winner;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 11e18;
        bytes32 digest = pot.settlementDigest(room, winners, amounts, new address[](0), new uint256[](0));
        vm.expectRevert(CenterGamePot.BadShare.selector);
        pot.settle(room, winners, amounts, new address[](0), new uint256[](0), _sig(digest));
    }

    function test_signed_pot_claim_is_bound_to_winner_amount_and_nonce() public {
        _open(CenterGamePot.Mode.Manual, 0);
        vm.prank(player);
        pot.enter(room);
        address[] memory winners = new address[](1);
        winners[0] = winner;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 10e18;
        bytes32 dig = pot.settlementDigest(room, winners, amounts, new address[](0), new uint256[](0));
        pot.settle(room, winners, amounts, new address[](0), new uint256[](0), _sig(dig));
        bytes memory claimSig = _sig(pot.claimWinningsDigest(room, winner, 10e18, 0));
        vm.prank(player);
        pot.claimWinnings(room, winner, 10e18, 0, claimSig);
        assertEq(token.balanceOf(winner), 10e18);
        vm.expectRevert(CenterGamePot.NonceReused.selector);
        pot.claimWinnings(room, winner, 10e18, 0, claimSig);
    }

    function test_creator_share_and_winner_payout_conserve_entry_pot() public {
        _open(CenterGamePot.Mode.Manual, 2000);
        vm.prank(player);
        pot.enter(room);
        address[] memory winners = new address[](1);
        winners[0] = winner;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 8e18;
        bytes32 dig = pot.settlementDigest(room, winners, amounts, new address[](0), new uint256[](0));
        uint256 before = token.balanceOf(creator);
        pot.settle(room, winners, amounts, new address[](0), new uint256[](0), _sig(dig));
        assertEq(token.balanceOf(creator) - before, 2e18);
        assertEq(token.balanceOf(winner), 0);
        bytes memory cs = _sig(pot.claimWinningsDigest(room, winner, 8e18, 0));
        vm.prank(winner);
        pot.claimWinnings(room, winner, 8e18, 0, cs);
        assertEq(token.balanceOf(winner), 8e18);
        assertEq(pot.tokenCommitted(address(token)), 0);
    }

    function test_refund_is_only_for_cancelled_room_and_once() public {
        _open(CenterGamePot.Mode.Manual, 0);
        vm.prank(player);
        pot.enter(room);
        vm.prank(player);
        vm.expectRevert(CenterGamePot.RefundNotAvailable.selector);
        pot.refundEntry(room);
        vm.prank(creator);
        pot.cancelRoom(room);
        vm.prank(player);
        pot.refundEntry(room);
        assertEq(token.balanceOf(player), 1000e18);
        vm.prank(player);
        vm.expectRevert(CenterGamePot.NotEntered.selector);
        pot.refundEntry(room);
    }

    function test_locked_nft_reward_auto_pays_only_signed_winner() public {
        _open(CenterGamePot.Mode.Auto, 0);
        uint256 id = 777;
        nft.mint(creator, id);
        vm.prank(creator);
        nft.approve(address(pot), id);
        vm.prank(creator);
        pot.lockRewardNFT(room, address(nft), id);
        vm.prank(player);
        pot.enter(room);
        address[] memory winners = new address[](1);
        winners[0] = winner;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 10e18;
        address[] memory rw = new address[](1);
        rw[0] = winner;
        uint256[] memory ri = new uint256[](1);
        ri[0] = 0;
        bytes32 dig = pot.settlementDigest(room, winners, amounts, rw, ri);
        pot.settle(room, winners, amounts, rw, ri, _sig(dig));
        assertEq(nft.ownerOf(id), winner);
    }
}
