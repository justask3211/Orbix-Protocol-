// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CenterVault} from "../../src/center/CenterVault.sol";
import {MockERC20, MockFeeOnTransferERC20} from "../../src/center/mocks/Mocks.sol";

contract CenterVaultTest is Test {
    CenterVault vault;
    MockERC20 token;

    address creator = address(0xC0FFEE);
    address other = address(0xBEEF);

    function setUp() public {
        token = new MockERC20("Center Test", "CTEST", 18);
        vault = new CenterVault(token);
        token.mint(creator, 1_000e18);
        token.mint(other, 1_000e18);
    }

    function test_deposit_credits_balance() public {
        vm.startPrank(creator);
        token.approve(address(vault), 100e18);
        vault.deposit(100e18);
        vm.stopPrank();
        assertEq(vault.balanceOf(creator), 100e18);
        assertEq(token.balanceOf(address(vault)), 100e18);
    }

    function test_deduct_is_idempotent_per_intent() public {
        _fund(creator, 100e18);
        bytes32 intent = keccak256("publish-1");
        bytes32 room = keccak256("room-1");

        vm.prank(creator);
        vault.deduct(intent, 7e18, room);
        assertEq(vault.balanceOf(creator), 93e18);

        // Same intent again must revert, no double charge.
        vm.prank(creator);
        vm.expectRevert(CenterVault.IntentAlreadyConsumed.selector);
        vault.deduct(intent, 7e18, room);
        assertEq(vault.balanceOf(creator), 93e18);

        // A different intent deducts normally.
        vm.prank(creator);
        vault.deduct(keccak256("publish-2"), 7e18, keccak256("room-2"));
        assertEq(vault.balanceOf(creator), 86e18);
    }

    function test_deduct_beyond_balance_reverts() public {
        _fund(creator, 5e18);
        vm.prank(creator);
        vm.expectRevert(CenterVault.InsufficientBalance.selector);
        vault.deduct(keccak256("i"), 6e18, keccak256("r"));
    }

    function test_refund_deduction_once_and_only_creator() public {
        _fund(creator, 100e18);
        bytes32 intent = keccak256("i");
        vm.prank(creator);
        vault.deduct(intent, 7e18, keccak256("r"));

        vm.prank(other);
        vm.expectRevert(CenterVault.NotCreator.selector);
        vault.refundDeduction(intent);

        vm.prank(creator);
        vault.refundDeduction(intent);
        assertEq(vault.balanceOf(creator), 100e18);

        vm.prank(creator);
        vm.expectRevert(CenterVault.AlreadyRefunded.selector);
        vault.refundDeduction(intent);
    }

    function test_withdraw_requires_delay_and_cannot_exceed_balance() public {
        _fund(creator, 100e18);

        vm.prank(creator);
        vault.requestWithdraw(100e18);

        vm.prank(creator);
        vm.expectRevert(CenterVault.TooEarly.selector);
        vault.executeWithdraw();

        vm.warp(block.timestamp + vault.WITHDRAW_DELAY());
        vm.prank(creator);
        vault.executeWithdraw();
        assertEq(token.balanceOf(creator), 1_000e18);
        assertEq(vault.balanceOf(creator), 0);
    }

    function test_withdraw_cannot_touch_committed_balance() public {
        // Deposit 10, deduct 8 for a published room, then the creator can withdraw at most 2.
        _fund(creator, 10e18);
        vm.prank(creator);
        vault.deduct(keccak256("i"), 8e18, keccak256("r"));

        vm.prank(creator);
        vm.expectRevert(CenterVault.InsufficientBalance.selector);
        vault.requestWithdraw(3e18);

        vm.prank(creator);
        vault.requestWithdraw(2e18);
        vm.warp(block.timestamp + vault.WITHDRAW_DELAY());
        vm.prank(creator);
        vault.executeWithdraw();
        assertEq(vault.balanceOf(creator), 0);
    }

    function test_fee_on_transfer_token_is_rejected() public {
        MockFeeOnTransferERC20 fee = new MockFeeOnTransferERC20();
        CenterVault v2 = new CenterVault(fee);
        fee.mint(creator, 100e18);
        vm.startPrank(creator);
        fee.approve(address(v2), 100e18);
        vm.expectRevert(CenterVault.TransferMismatch.selector);
        v2.deposit(100e18);
        vm.stopPrank();
    }

    function testFuzz_deduct_accounting(uint96 depositAmt, uint96 deductAmt) public {
        depositAmt = uint96(bound(depositAmt, 1, 1_000e18));
        deductAmt = uint96(bound(deductAmt, 1, depositAmt));
        _fund(creator, depositAmt);
        vm.prank(creator);
        vault.deduct(keccak256("i"), deductAmt, keccak256("r"));
        assertEq(vault.balanceOf(creator), uint256(depositAmt) - uint256(deductAmt));
    }

    function _fund(address who, uint256 amount) internal {
        vm.startPrank(who);
        token.approve(address(vault), amount);
        vault.deposit(amount);
        vm.stopPrank();
    }
}
