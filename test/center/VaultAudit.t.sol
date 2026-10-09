// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CenterVault} from "../../src/center/CenterVault.sol";

contract AuditVaultToken is ERC20 {
    CenterVault public vault;
    bool public feeEnabled;
    bool public callbackEnabled;
    bool public callbackBlocked;
    constructor() ERC20("Audit token", "AUD") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function configure(CenterVault target, bool fee, bool callback) external {
        vault = target; feeEnabled = fee; callbackEnabled = callback;
    }
    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        bool ok = super.transferFrom(from, to, value);
        if (callbackEnabled) {
            callbackEnabled = false;
            try vault.deposit(1) {} catch { callbackBlocked = true; }
        }
        return ok;
    }
    function _update(address from, address to, uint256 value) internal override {
        if (feeEnabled && from != address(0) && to != address(0)) {
            super._update(from, address(0xdead), value / 100);
            super._update(from, to, value - value / 100);
        } else { super._update(from, to, value); }
    }
}

contract VaultAuditTest is Test {
    address creator = address(0xCA);
    function test_constructor_cannot_accept_eoa_token() public {
        vm.expectRevert(CenterVault.TransferMismatch.selector);
        new CenterVault(IERC20(address(0xBAD)));
    }
    function test_token_callback_cannot_reenter_deposit() public {
        AuditVaultToken token = new AuditVaultToken();
        CenterVault vault = new CenterVault(token);
        token.configure(vault, false, true);
        token.mint(creator, 100);
        vm.startPrank(creator); token.approve(address(vault), 100); vault.deposit(100); vm.stopPrank();
        assertTrue(token.callbackBlocked());
        assertEq(vault.balanceOf(creator), 100);
        assertEq(vault.balanceOf(address(token)), 0);
        assertEq(token.balanceOf(address(vault)), 100);
    }
    function test_dynamic_outgoing_fee_cannot_silently_shortchange_withdrawal() public {
        AuditVaultToken token = new AuditVaultToken();
        CenterVault vault = new CenterVault(token);
        token.mint(creator, 10000);
        vm.startPrank(creator); token.approve(address(vault), 10000); vault.deposit(10000); vault.requestWithdraw(10000); vm.stopPrank();
        token.configure(vault, true, false);
        vm.warp(block.timestamp + vault.WITHDRAW_DELAY());
        vm.prank(creator); vm.expectRevert(CenterVault.TransferMismatch.selector); vault.executeWithdraw();
        assertEq(vault.balanceOf(creator), 10000);
        assertEq(vault.pendingWithdrawAmount(creator), 10000);
        assertEq(token.balanceOf(address(vault)), 10000);
        assertEq(token.balanceOf(creator), 0);
    }
}
