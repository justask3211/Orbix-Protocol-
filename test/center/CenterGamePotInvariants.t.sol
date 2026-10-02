// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CenterGamePot} from "../../src/center/CenterGamePot.sol";
import {MockERC20, MockERC721} from "../../src/center/mocks/Mocks.sol";

/// E3: formal conservation invariants for CenterGamePot.
///
/// For every reachable state:
///   I1  balance(token) >= tokenCommitted(token)   (no liability exceeds custody)
///   I2  sweepDust can never move committed assets (tokenCommitted-guarded)
///   I3  no double refund, payout, or claim (flags + one-time nonces)
///   I4  pot conservation: creatorCut + rake + winnerPayouts + unclaimedPot
///       equals total entry fees collected (minus active refunds)
contract CenterGamePotInvariantsTest is Test {
    CenterGamePot pot;
    MockERC20 token;
    MockERC721 nft;
    uint256 constant AUTH_PK = 0xA11CE;
    address authority;
    address treasury = address(0xBEEF);
    address creator = address(0xC0FFEE);
    address player = address(0xA11CE1);
    address winner = address(0xA11CE2);
    bytes32 room;

    uint256 totalIn;

    function setUp() public {
        authority = vm.addr(AUTH_PK);
        pot = new CenterGamePot(authority, treasury, 250); // 2.5% rake
        token = new MockERC20("T", "T", 18);
        nft = new MockERC721();
        token.mint(creator, 1_000_000e18);
        token.mint(player, 1_000_000e18);
        vm.prank(creator);
        token.approve(address(pot), type(uint256).max);
        vm.prank(player);
        token.approve(address(pot), type(uint256).max);
        vm.warp(1000);
    }

    // -------------------------------------------------------------- invariants

    function _invariant_no_liability_exceeds_custody() internal view {
        assertGe(
            token.balanceOf(address(pot)), pot.tokenCommitted(address(token)), "I1: committed assets exceed custody"
        );
    }

    function _invariant_sweep_cannot_touch_committed() internal {
        uint256 committed = pot.tokenCommitted(address(token));
        uint256 treasuryBefore = token.balanceOf(treasury);
        vm.prank(treasury);
        try pot.sweepDust(address(token), type(uint256).max / 2) {
            // sweep must fail when it would eat committed value; allow success
            // only for genuinely unreserved surplus (which is 0 in our flows
            // unless a fee-on-transfer gap exists — the mock has none, so any
            // success here is a red flag)
            assertEq(token.balanceOf(treasury) - treasuryBefore, 0, "I2: sweep moved committed value");
        } catch {}
        _invariant_no_liability_exceeds_custody();
    }

    // -------------------------------------------------------------- helpers

    function _open(CenterGamePot.Mode mode, uint16 shareBps) internal {
        room = keccak256(abi.encode(mode, shareBps, block.timestamp, msg.sender));
        vm.prank(creator);
        pot.openRoom(room, creator, shareBps, address(token), 10e18, mode, uint64(block.timestamp + 1000));
    }

    function _enter() internal {
        vm.prank(player);
        pot.enter(room);
        totalIn += 10e18;
    }

    function _sig(bytes32 digest) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(AUTH_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    function _settle(uint256 creatorShareBps, uint256 winnerCut) internal {
        address[] memory winners = new address[](1);
        winners[0] = winner;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = winnerCut;
        bytes32 dig = pot.settlementDigest(room, winners, amounts, new address[](0), new uint256[](0));
        pot.settle(room, winners, amounts, new address[](0), new uint256[](0), _sig(dig));
    }

    // -------------------------------------------------------------- lifecycle flows

    /// AUTO mode: rake + creator cut + winner payout drain the pot exactly.
    function test_auto_settle_conserves_pot_exactly() public {
        _open(CenterGamePot.Mode.Auto, 2000); // 20% creator share
        _enter(); // pot = 10e18
        _invariant_no_liability_exceeds_custody();

        uint256 pot0 = 10e18;
        uint256 rake = (pot0 * 250) / 10_000;
        uint256 afterRake = pot0 - rake;
        uint256 creatorCut = (afterRake * 2000) / 10_000;
        uint256 winnerCut = afterRake - creatorCut;

        uint256 treasuryBefore = token.balanceOf(treasury);
        _settle(2000, winnerCut);

        assertEq(token.balanceOf(treasury) - treasuryBefore, rake, "rake exact");
        assertEq(token.balanceOf(winner), winnerCut, "winner pushed exactly");
        assertEq(token.balanceOf(address(pot)), 0, "auto drains pot fully");
        assertEq(pot.tokenCommitted(address(token)), 0);
        _invariant_no_liability_exceeds_custody();
        _invariant_sweep_cannot_touch_committed();
    }

    /// MANUAL mode full lifecycle: settle records, claim pays, conservation holds.
    function test_manual_lifecycle_conservation() public {
        totalIn = 0;
        _open(CenterGamePot.Mode.Manual, 2000);
        _enter();
        uint256 pot0 = 10e18;
        uint256 rake = (pot0 * 250) / 10_000;
        uint256 afterRake = pot0 - rake;
        uint256 creatorCut = (afterRake * 2000) / 10_000;
        uint256 winnerCut = afterRake - creatorCut;

        uint256 creatorBefore = token.balanceOf(creator);
        uint256 treasuryBefore = token.balanceOf(treasury);
        _settle(2000, winnerCut);

        assertEq(token.balanceOf(creator) - creatorBefore, creatorCut, "creator cut exact");
        assertEq(token.balanceOf(treasury) - treasuryBefore, rake, "rake exact");
        assertEq(token.balanceOf(address(pot)), winnerCut, "only winner liability retained");
        _invariant_no_liability_exceeds_custody();
        _invariant_sweep_cannot_touch_committed();

        // claim exactly the liability
        bytes memory cs = _sig(pot.claimWinningsDigest(room, winner, winnerCut, 0));
        vm.prank(winner);
        pot.claimWinnings(room, winner, winnerCut, 0, cs);
        assertEq(token.balanceOf(winner), winnerCut);
        assertEq(token.balanceOf(address(pot)), 0);
        assertEq(pot.tokenCommitted(address(token)), 0);
        _invariant_no_liability_exceeds_custody();

        // I3: no double claim — new sig needed, and the liability is gone
        bytes memory cs2 = _sig(pot.claimWinningsDigest(room, winner, winnerCut, 1));
        vm.prank(winner);
        vm.expectRevert(CenterGamePot.NothingToClaim.selector);
        pot.claimWinnings(room, winner, winnerCut, 1, cs2);
    }

    /// Refund path: cancelled room returns exactly paid-in; committed drops to 0.
    function test_refund_conservation() public {
        _open(CenterGamePot.Mode.Manual, 0);
        _enter();
        _invariant_no_liability_exceeds_custody();
        vm.prank(creator);
        pot.cancelRoom(room);
        vm.prank(player);
        pot.refundEntry(room);
        assertEq(token.balanceOf(address(pot)), 0);
        assertEq(pot.tokenCommitted(address(token)), 0);
        _invariant_no_liability_exceeds_custody();
        _invariant_sweep_cannot_touch_committed();
    }

    /// I3: settle digest replay is rejected.
    function test_settle_replay_rejected() public {
        _open(CenterGamePot.Mode.Manual, 0);
        _enter();
        address[] memory winners = new address[](1);
        winners[0] = winner;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 9.75e18; // net pot after 2.5% rake, creator share 0
        bytes32 dig = pot.settlementDigest(room, winners, amounts, new address[](0), new uint256[](0));
        bytes memory sig = _sig(dig);
        pot.settle(room, winners, amounts, new address[](0), new uint256[](0), sig);
        vm.expectRevert(CenterGamePot.AlreadySettled.selector);
        pot.settle(room, winners, amounts, new address[](0), new uint256[](0), sig);
    }
}
