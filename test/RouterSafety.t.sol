// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/OrbixRouter.sol";
import "../src/OrbixFactory.sol";
import "../src/OrbixPair.sol";
import "../src/WETH9.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract SafetyToken is ERC20 {
    constructor() ERC20("Safety", "SAFE") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract SyncReentryToken is SafetyToken {
    address public target;
    bool public attempted;
    bool public blocked;
    function setTarget(address pair) external { target = pair; }
    function balanceOf(address owner) public view override returns (uint256) {
        if (owner == target && target != address(0)) {
            // staticcall context disallows writes, but a view reentrant call to sync still reaches the lock.
            (bool ok, bytes memory data) = target.staticcall(abi.encodeWithSignature("sync()"));
            require(!ok && data.length >= 4, "sync reentry unexpectedly succeeded");
        }
        return super.balanceOf(owner);
    }
}

contract RouterSafetyTest is Test {
    OrbixFactory factory;
    OrbixRouter router;
    SafetyToken a;
    SafetyToken b;
    WETH9 weth;
    address alice = address(0xBEEF);

    function setUp() public {
        factory = new OrbixFactory();
        weth = new WETH9();
        router = new OrbixRouter(address(factory), address(weth));
        a = new SafetyToken();
        b = new SafetyToken();
        a.mint(alice, 1_000_000 ether);
        b.mint(alice, 1_000_000 ether);
        vm.startPrank(alice);
        a.approve(address(router), type(uint256).max);
        b.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }
    function _path(address x, address y) internal pure returns (address[] memory p) {
        p = new address[](2); p[0] = x; p[1] = y;
    }
    function _seed(uint256 x, uint256 y) internal returns (OrbixPair pair) {
        vm.prank(alice);
        router.addLiquidity(address(a), address(b), x, y, 0, 0, alice, block.timestamp);
        pair = OrbixPair(factory.getPair(address(a), address(b)));
    }

    function test_ConstructorRejectsZeroDependencies() public {
        vm.expectRevert(OrbixPair.ZeroAddress.selector);
        new OrbixPair(address(0), address(a));
    }
    function test_InitialLiquidityEnforcesBothMinimums() public {
        vm.startPrank(alice);
        vm.expectRevert(OrbixRouter.InsufficientAmount.selector);
        router.addLiquidity(address(a), address(b), 10 ether, 20 ether, 11 ether, 0, alice, block.timestamp);
        vm.expectRevert(OrbixRouter.InsufficientAmount.selector);
        router.addLiquidity(address(a), address(b), 10 ether, 20 ether, 0, 21 ether, alice, block.timestamp);
        vm.stopPrank();
        assertEq(factory.getPair(address(a), address(b)), address(0));
    }
    function test_ExistingLiquidityEnforcesBothMinimums() public {
        _seed(10 ether, 20 ether);
        vm.prank(alice);
        vm.expectRevert(OrbixRouter.InsufficientAmount.selector);
        router.addLiquidity(address(a), address(b), 1 ether, 2 ether, 2 ether, 0, alice, block.timestamp);
    }
    function test_ReverseRemoveReturnsCallerOrderAndChecksCorrectMinimum() public {
        OrbixPair pair = _seed(10 ether, 20 ether);
        uint256 liq = pair.balanceOf(alice);
        vm.startPrank(alice);
        pair.approve(address(router), liq);
        vm.expectRevert(OrbixRouter.InsufficientAmount.selector);
        router.removeLiquidity(address(b), address(a), liq, 20 ether, 0, alice, block.timestamp);
        (uint256 outB, uint256 outA) = router.removeLiquidity(address(b), address(a), liq, 0, 0, alice, block.timestamp);
        vm.stopPrank();
        assertGt(outB, outA);
        assertApproxEqAbs(outB, outA * 2, 2000);
    }
    function test_InvalidPathsRecipientsAndMissingPairs() public {
        address[] memory empty = new address[](0);
        vm.expectRevert(OrbixRouter.InvalidPath.selector);
        router.getAmountsOut(1 ether, empty);
        vm.expectRevert(OrbixRouter.PairNotFound.selector);
        router.getAmountsOut(1 ether, _path(address(a), address(b)));
        vm.expectRevert(OrbixRouter.InvalidPath.selector);
        router.getAmountsOut(1 ether, _path(address(a), address(a)));
        vm.expectRevert(OrbixRouter.PairNotFound.selector);
        router.removeLiquidity(address(a), address(b), 1, 0, 0, alice, block.timestamp);
        vm.expectRevert(OrbixRouter.InvalidPath.selector);
        router.swapExactTokensForETH(1, 0, empty, alice, block.timestamp);
        vm.expectRevert(OrbixRouter.InvalidPath.selector);
        router.swapExactETHForTokens(0, empty, alice, block.timestamp);
        vm.expectRevert(OrbixRouter.InvalidPath.selector);
        router.addLiquidity(address(a), address(b), 1 ether, 1 ether, 0, 0, address(0), block.timestamp);
    }
    function test_QuotesRejectZeroReserves() public {
        vm.expectRevert(OrbixRouter.InsufficientAmount.selector);
        router.getAmountOut(1, 0, 1);
        vm.expectRevert(OrbixRouter.InsufficientAmount.selector);
        router.getAmountOut(1, 1, 0);
        factory.createPair(address(a), address(b));
        vm.expectRevert(OrbixRouter.InsufficientAmount.selector);
        router.getAmountsOut(1, _path(address(a), address(b)));
    }
    function test_FuzzSwapConservesBalancesAndInvariant(uint96 amount) public {
        OrbixPair pair = _seed(1000 ether, 2000 ether);
        amount = uint96(bound(amount, 1e12, 100 ether));
        uint256 beforeA = a.balanceOf(alice);
        uint256 beforeB = b.balanceOf(alice);
        (uint112 r0, uint112 r1,) = pair.getReserves();
        vm.prank(alice);
        uint256[] memory outs = router.swapExactTokensForTokens(amount, 1, _path(address(a), address(b)), alice, block.timestamp);
        assertEq(beforeA - a.balanceOf(alice), amount);
        assertEq(b.balanceOf(alice) - beforeB, outs[1]);
        (uint112 s0, uint112 s1,) = pair.getReserves();
        assertGe(uint256(s0) * s1, uint256(r0) * r1);
        assertEq(a.balanceOf(address(pair)), a.totalSupply() - a.balanceOf(alice));
        assertEq(b.balanceOf(address(pair)), b.totalSupply() - b.balanceOf(alice));
    }
    function test_FuzzMintBurnReverseOrder(uint96 x, uint96 y) public {
        x = uint96(bound(x, 1 ether, 1000 ether));
        y = uint96(bound(y, 1 ether, 1000 ether));
        vm.prank(alice);
        (, , uint256 liquidity) = router.addLiquidity(address(b), address(a), y, x, 0, 0, alice, block.timestamp);
        OrbixPair pair = OrbixPair(factory.getPair(address(a), address(b)));
        vm.prank(alice);
        pair.approve(address(router), liquidity);
        uint256 beforeA = a.balanceOf(alice);
        uint256 beforeB = b.balanceOf(alice);
        vm.prank(alice);
        (uint256 outA, uint256 outB) = router.removeLiquidity(address(a), address(b), liquidity, 0, 0, alice, block.timestamp);
        assertEq(outA, a.balanceOf(alice) - beforeA);
        assertEq(outB, b.balanceOf(alice) - beforeB);
        assertLe(outA, x);
        assertLe(outB, y);
    }
    function test_FuzzDonationSyncAndPriorReserveTWAP(uint96 donation, uint32 elapsed) public {
        OrbixPair pair = _seed(10 ether, 20 ether);
        donation = uint96(bound(donation, 1, 10 ether));
        elapsed = uint32(bound(elapsed, 1, 10000));
        uint256 price0 = pair.price0CumulativeLast();
        uint256 price1 = pair.price1CumulativeLast();
        (uint112 r0, uint112 r1,) = pair.getReserves();
        vm.prank(alice);
        a.transfer(address(pair), donation);
        vm.warp(block.timestamp + elapsed);
        pair.sync();
        (uint112 s0, uint112 s1,) = pair.getReserves();
        if (pair.token0() == address(a)) assertEq(s0, uint256(r0) + donation);
        else assertEq(s1, uint256(r1) + donation);
        assertEq(pair.price0CumulativeLast() - price0, ((uint256(r1) << 112) / r0) * elapsed);
        assertEq(pair.price1CumulativeLast() - price1, ((uint256(r0) << 112) / r1) * elapsed);
    }
    function test_TWAPTimestampWrap() public {
        vm.warp(uint256(type(uint32).max) - 3);
        OrbixPair pair = _seed(10 ether, 20 ether);
        (uint112 r0, uint112 r1,) = pair.getReserves();
        uint256 prior = pair.price0CumulativeLast();
        vm.warp(uint256(type(uint32).max) + 7);
        pair.sync();
        assertEq(pair.price0CumulativeLast() - prior, ((uint256(r1) << 112) / r0) * 10);
    }
}
