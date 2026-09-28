// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/OrbixFactory.sol";
import "../src/OrbixRouter.sol";
import "../src/OrbixPair.sol";
import "../src/WETH9.sol";
import "../src/OrbixLaunchpad.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract LpMock is ERC20 {
    constructor(string memory n) ERC20(n, n) {}
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

contract LaunchpadTest is Test {
    OrbixFactory factory;
    OrbixRouter router;
    WETH9 weth;
    LpMock collateral;
    LpMock ecoCollateral;
    OrbixLaunchpad pad;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address treasury = makeAddr("treasury");

    function setUp() public {
        weth = new WETH9();
        factory = new OrbixFactory();
        router = new OrbixRouter(address(factory), address(weth));
        collateral = new LpMock("USDCx");
        ecoCollateral = new LpMock("ECO");
        pad = new OrbixLaunchpad(address(factory), address(router), treasury, 0.001 ether, 7 days);
        pad.setCollateral(address(collateral), true);
        pad.setCollateral(address(ecoCollateral), true);
        collateral.mint(alice, 1_000_000 ether);
        ecoCollateral.mint(alice, 1_000_000 ether);
        ecoCollateral.mint(bob, 1_000_000 ether);
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    function _launch(address who, address col, uint256 tokenSeed, uint256 colSeed, bool lock)
        internal returns (address token, address pair)
    {
        vm.startPrank(who);
        LpMock(col).approve(address(pad), type(uint256).max);
        (token, pair) = pad.createLaunch{value: 0.001 ether}("Arc Reactor", "ARC", 1_000_000 ether, col, tokenSeed, colSeed, lock);
        vm.stopPrank();
    }

    function test_LaunchCreatesTokenPairAndLiquidity() public {
        (address token, address pair) = _launch(alice, address(collateral), 100_000 ether, 100 ether, true);
        assertTrue(token != address(0), "token deployed");
        assertGt(token.code.length, 0, "token bytecode present");
        assertEq(LaunchToken(token).totalSupply(), 1_000_000 ether);
        assertEq(LaunchToken(token).balanceOf(alice), 900_000 ether, "creator keeps rest");
        assertTrue(pair != address(0), "pair created");
        (uint112 r0, uint112 r1,) = OrbixPair(pair).getReserves();
        assertGt(uint256(r0), 0);
        assertGt(uint256(r1), 0);
        // liquidity escrowed while locked
        assertEq(OrbixPair(pair).balanceOf(address(pad)) > 0, true, "LP held by pad");
        assertEq(pad.allLaunchTokens(0), token);
    }

    function test_LaunchTokenIsTradeableOnAmm() public {
        (address token, address pair) = _launch(alice, address(collateral), 100_000 ether, 100 ether, false);
        // alice received the LP back (no lock) and can sell tokens into the pool
        uint256 balBefore = collateral.balanceOf(alice);
        vm.startPrank(alice);
        LaunchToken(token).approve(address(router), type(uint256).max);
        address[] memory path = new address[](2);
        path[0] = token;
        path[1] = address(collateral);
        uint256 out = router.getAmountsOut(1_000 ether, path)[1];
        assertGt(out, 0, "quotable");
        router.swapExactTokensForTokens(1_000 ether, out * 99 / 100, path, alice, block.timestamp + 600);
        vm.stopPrank();
        assertGt(collateral.balanceOf(alice), balBefore, "collateral received from sale");
        assertGt(LaunchToken(token).balanceOf(pair), 0);
    }

    function test_TwoLaunchedTokensFormTheirOwnPair() public {
        (address tokenA,) = _launch(alice, address(collateral), 50_000 ether, 50 ether, false);
        vm.startPrank(bob);
        LpMock(address(ecoCollateral)).approve(address(pad), type(uint256).max);
        (address tokenB,) = pad.createLaunch{value: 0.001 ether}("Second Launch", "SEC", 500_000 ether, address(ecoCollateral), 25_000 ether, 25 ether, false);
        vm.stopPrank();
        assertTrue(tokenA != tokenB);
        // permissionless pair between two user-launched tokens
        address pair = factory.createPair(tokenA, tokenB);
        assertTrue(pair != address(0), "user tokens can pair with each other");
        assertEq(OrbixPair(pair).token0() == tokenA || OrbixPair(pair).token0() == tokenB, true);
    }

    function test_LiquiditySellIntoUserPair() public {
        (address tokenA,) = _launch(alice, address(collateral), 400_000 ether, 40 ether, false);
        vm.startPrank(bob);
        LpMock(address(ecoCollateral)).approve(address(pad), type(uint256).max);
        (address tokenB,) = pad.createLaunch{value: 0.001 ether}("Beta", "BTA", 400_000 ether, address(ecoCollateral), 20_000 ether, 20 ether, false);
        // bob holds the BTA leftovers — send alice enough to seed the A/B pair
        LaunchToken(tokenB).transfer(alice, 100_000 ether);
        vm.stopPrank();
        // seed A/B pair and swap A -> B through the router
        vm.startPrank(alice);
        LaunchToken(tokenA).approve(address(router), type(uint256).max);
        LaunchToken(tokenB).approve(address(router), type(uint256).max);
        router.addLiquidity(tokenA, tokenB, 10_000 ether, 100_000 ether, 9_000 ether, 90_000 ether, alice, block.timestamp + 600);
        uint256 before = LaunchToken(tokenB).balanceOf(alice);
        address[] memory path = new address[](2);
        path[0] = tokenA;
        path[1] = tokenB;
        router.swapExactTokensForTokens(500 ether, 0, path, alice, block.timestamp + 600);
        vm.stopPrank();
        assertGt(LaunchToken(tokenB).balanceOf(alice), before, "cross-token swap works");
    }

    function test_RevertUnsupportedCollateral() public {
        LpMock rogue = new LpMock("ROGUE");
        rogue.mint(alice, 100 ether);
        vm.startPrank(alice);
        rogue.approve(address(pad), type(uint256).max);
        vm.expectRevert(OrbixLaunchpad.CollateralNotAllowed.selector);
        pad.createLaunch{value: 0.001 ether}("Rogue", "RGE", 1 ether, address(rogue), 1 ether, 1 ether, false);
        vm.stopPrank();
    }

    function test_RevertDuplicateLaunchPerCreator() public {
        _launch(alice, address(collateral), 10_000 ether, 10 ether, false);
        vm.startPrank(alice);
        collateral.approve(address(pad), type(uint256).max);
        vm.expectRevert(OrbixLaunchpad.AlreadyLaunched.selector);
        pad.createLaunch{value: 0.001 ether}("Second", "SEC", 1_000 ether, address(collateral), 1_000 ether, 1 ether, false);
        vm.stopPrank();
    }

    function test_RevertCreationFeeMissing() public {
        vm.startPrank(alice);
        collateral.approve(address(pad), type(uint256).max);
        vm.expectRevert(OrbixLaunchpad.NativeFeeRequired.selector);
        pad.createLaunch("NoFee", "NF", 1_000 ether, address(collateral), 100 ether, 1 ether, false);
        vm.stopPrank();
    }

    function test_LockedLiquidityCannotBePulledEarly() public {
        _launch(alice, address(collateral), 50_000 ether, 50 ether, true);
        vm.startPrank(alice);
        vm.expectRevert(OrbixLaunchpad.LockActive.selector);
        pad.closeLaunch();
        vm.warp(block.timestamp + 7 days + 1);
        pad.closeLaunch();
        vm.stopPrank();
        (,,,,,,,,bool act,) = pad.launches(alice);
        assertEq(act, false);
    }

    function test_FeesRouteToTreasury() public {
        _launch(alice, address(collateral), 10_000 ether, 10 ether, false);
        uint256 before = treasury.balance;
        pad.withdrawFees();
        assertEq(treasury.balance - before, 0.001 ether);
    }

    receive() external payable {}
}
