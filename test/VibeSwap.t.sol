// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/OrbixFactory.sol";
import "../src/OrbixPair.sol";
import "../src/OrbixRouter.sol";
import "../src/WETH9.sol";
import "../src/OrbixEcoToken.sol";
import "../src/OrbixMasterChef.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory n) ERC20(n, n) {}
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

contract VibeSwapTest is Test {
    OrbixFactory factory;
    OrbixRouter router;
    WETH9 weth;
    MockToken tokenA;
    MockToken tokenB;
    OrbixEcoToken eco;
    OrbixMasterChef chef;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address minter = makeAddr("minter");

    function setUp() public {
        weth = new WETH9();
        factory = new OrbixFactory();
        router = new OrbixRouter(address(factory), address(weth));
        tokenA = new MockToken("TKA");
        tokenB = new MockToken("TKB");
        eco = new OrbixEcoToken(minter, 1_000_000_000 ether);
        tokenA.mint(alice, 1_000_000 ether);
        tokenB.mint(alice, 1_000_000 ether);
        tokenA.mint(bob, 1_000_000 ether);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    function _deadline() internal view returns (uint256) { return block.timestamp + 600; }

    // ---------- Factory ----------
    function test_CreatePairDeterministic() public {
        address p1 = factory.createPair(address(tokenA), address(tokenB));
        vm.expectRevert(OrbixFactory.PairExists.selector);
        factory.createPair(address(tokenB), address(tokenA));
        (address t0, address t1) = address(tokenA) < address(tokenB) ? (address(tokenA), address(tokenB)) : (address(tokenB), address(tokenA));
        assertEq(factory.getPair(t0, t1), p1);
        assertEq(OrbixPair(p1).token0(), t0);
    }

    function test_RevertIdentical() public {
        vm.expectRevert(OrbixFactory.IdenticalAddresses.selector);
        factory.createPair(address(tokenA), address(tokenA));
    }

    // ---------- Liquidity ----------
    function test_AddRemoveLiquidity() public {
        vm.startPrank(alice);
        tokenA.approve(address(router), type(uint256).max);
        tokenB.approve(address(router), type(uint256).max);
        (uint256 a, uint256 b, uint256 liq) = router.addLiquidity(
            address(tokenA), address(tokenB), 100 ether, 100 ether, 90 ether, 90 ether, alice, _deadline());
        assertGt(liq, 0, "liquidity minted");
        address pair = factory.getPair(
            address(tokenA) < address(tokenB) ? address(tokenA) : address(tokenB),
            address(tokenA) < address(tokenB) ? address(tokenB) : address(tokenA));
        assertEq(OrbixPair(pair).balanceOf(alice), liq);
        // remove
        OrbixPair(pair).approve(address(router), type(uint256).max);
        (uint256 outA, uint256 outB) = router.removeLiquidity(
            address(tokenA), address(tokenB), liq, 0, 0, alice, _deadline());
        assertGt(outA, 0);
        assertGt(outB, 0);
        vm.stopPrank();
    }

    // ---------- Swap ----------
    function test_SwapTokensExactIn() public {
        vm.startPrank(alice);
        tokenA.approve(address(router), type(uint256).max);
        tokenB.approve(address(router), type(uint256).max);
        router.addLiquidity(address(tokenA), address(tokenB), 100 ether, 100 ether, 90 ether, 90 ether, alice, _deadline());
        vm.stopPrank();

        uint256 balBefore = tokenB.balanceOf(bob);
        vm.startPrank(bob);
        tokenA.approve(address(router), type(uint256).max);
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);
        router.swapExactTokensForTokens(1 ether, 0, path, bob, _deadline());
        vm.stopPrank();
        assertGt(tokenB.balanceOf(bob), balBefore, "bob received TKB");
    }

    function test_SwapSlippageProtection() public {
        vm.startPrank(alice);
        tokenA.approve(address(router), type(uint256).max);
        tokenB.approve(address(router), type(uint256).max);
        router.addLiquidity(address(tokenA), address(tokenB), 100 ether, 100 ether, 90 ether, 90 ether, alice, _deadline());
        vm.stopPrank();
        vm.startPrank(bob);
        tokenA.approve(address(router), type(uint256).max);
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);
        vm.expectRevert(OrbixRouter.InsufficientOutput.selector);
        router.swapExactTokensForTokens(1 ether, type(uint256).max, path, bob, _deadline());
        vm.stopPrank();
    }

    function test_SwapETHForTokensAndBack() public {
        vm.startPrank(alice);
        tokenA.approve(address(router), type(uint256).max);
        weth.deposit{value: 10 ether}();
        weth.approve(address(router), type(uint256).max);
        weth.transfer(address(factory), 0); // noop warm
        // create WETH/TKA pair via router addLiquidity
        router.addLiquidity(address(weth), address(tokenA), 10 ether, 1000 ether, 5 ether, 500 ether, alice, _deadline());
        vm.stopPrank();

        uint256 before = tokenA.balanceOf(bob);
        vm.startPrank(bob);
        address[] memory path = new address[](2);
        path[0] = address(weth);
        path[1] = address(tokenA);
        router.swapExactETHForTokens{value: 1 ether}(0, path, bob, _deadline());
        assertGt(tokenA.balanceOf(bob), before);
        // back to ETH
        tokenA.approve(address(router), type(uint256).max);
        address[] memory pathBack = new address[](2);
        pathBack[0] = address(tokenA);
        pathBack[1] = address(weth);
        uint256 ethBefore = bob.balance;
        router.swapExactTokensForETH(tokenA.balanceOf(bob) / 2, 0, pathBack, bob, _deadline());
        assertGt(bob.balance, ethBefore);
        vm.stopPrank();
    }

    // ---------- Fee math ----------
    function test_FeeApplied() public {
        // 997/1000 fee: quote 1000 in, reserves 1M/1M
        uint256 out = router.getAmountOut(1000 ether, 1_000_000 ether, 1_000_000 ether);
        assertLt(out, 1000 ether);
        assertApproxEqRel(out, 997 ether, 1e15);
    }

    // ---------- MasterChef ----------
    function _addChefPool() internal returns (uint256 pid) {
        chef = new OrbixMasterChef(address(eco), 10 ether, block.number + 1);
        // fund chef with ECO for rewards
        vm.startPrank(minter);
        eco.mint(address(chef), 1_000_000 ether);
        vm.stopPrank();
        chef.add(100, IERC20(address(tokenA)));
        return 0;
    }

    function test_StakeEarnWithdraw() public {
        uint256 pid = _addChefPool();
        uint256 amount = 10 ether;
        vm.roll(block.number + 2);
        vm.startPrank(alice);
        tokenA.approve(address(chef), type(uint256).max);
        chef.deposit(pid, amount);
        assertEq(chef.staked(alice, pid), amount);
        uint256 before = eco.balanceOf(alice);
        vm.roll(block.number + 100);
        uint256 pending = chef.pendingEco(pid, alice);
        assertGt(pending, 0, "rewards accrue");
        chef.withdraw(pid, amount);
        chef.harvest();
        assertEq(eco.balanceOf(alice) - before, pending, "harvested exactly pending");
        assertEq(tokenA.balanceOf(alice), 1_000_000 ether, "principal returned");
        vm.stopPrank();
    }

    function test_TwoUsersProRata() public {
        uint256 pid = _addChefPool();
        vm.roll(block.number + 2);
        vm.startPrank(alice);
        tokenA.approve(address(chef), type(uint256).max);
        chef.deposit(pid, 30 ether);
        vm.stopPrank();
        vm.startPrank(bob);
        tokenA.approve(address(chef), type(uint256).max);
        chef.deposit(pid, 10 ether);
        vm.stopPrank();
        vm.roll(block.number + 100);
        // alice 75%, bob 25% of 100 blocks * 10 eco
        uint256 pA = chef.pendingEco(pid, alice);
        uint256 pB = chef.pendingEco(pid, bob);
        assertApproxEqRel(pA, 750 ether, 1e15);
        assertApproxEqRel(pB, 250 ether, 1e15);
    }

    // ---------- Regression: TWAP accumulators (H-01) ----------
    function test_TWAPUsesReserveRatio() public {
        address pair = factory.createPair(address(tokenA), address(tokenB));
        address t0 = OrbixPair(pair).token0();
        address t1 = OrbixPair(pair).token1();
        // make reserves asymmetric: 100 of t0, 200 of t1
        vm.startPrank(alice);
        MockToken(t0).transfer(pair, 100 ether);
        MockToken(t1).transfer(pair, 200 ether);
        OrbixPair(pair).mint(alice);
        vm.stopPrank();
        (uint112 r0, uint112 r1, ) = OrbixPair(pair).getReserves();
        assertEq(uint256(r0), 100 ether);
        assertEq(uint256(r1), 200 ether);

        // no time passed yet -> accumulators are zero
        assertEq(OrbixPair(pair).price0CumulativeLast(), 0);

        vm.warp(block.timestamp + 100);
        OrbixPair(pair).sync();

        // price0 = r1/r0 in UQ112x112 * elapsed ; price1 = r0/r1 * elapsed
        uint256 expected0 = (uint256(r1) << 112) / r0 * 100;
        uint256 expected1 = (uint256(r0) << 112) / r1 * 100;
        assertEq(OrbixPair(pair).price0CumulativeLast(), expected0, "price0 accumulator");
        assertEq(OrbixPair(pair).price1CumulativeLast(), expected1, "price1 accumulator");
        // asymmetric pool: price0 must be ~2x price1 (ratio 4x in UQ terms: (2<<112) vs (0.5<<112))
        assertGt(OrbixPair(pair).price0CumulativeLast(), 3 * OrbixPair(pair).price1CumulativeLast(), "ratio inverted?");
    }

    // ---------- Regression: multi-pool harvest (H-02) ----------
    function test_MultiPoolHarvestSettlesEveryPool() public {
        chef = new OrbixMasterChef(address(eco), 10 ether, block.number + 1);
        vm.startPrank(minter);
        eco.mint(address(chef), 1_000_000 ether);
        vm.stopPrank();
        chef.add(100, IERC20(address(tokenA)));
        chef.add(100, IERC20(address(tokenB)));

        vm.roll(block.number + 2);
        vm.startPrank(alice);
        tokenA.approve(address(chef), type(uint256).max);
        tokenB.approve(address(chef), type(uint256).max);
        chef.deposit(0, 10 ether);
        chef.deposit(1, 10 ether);
        vm.roll(block.number + 100);

        uint256 pA = chef.pendingEco(0, alice);
        uint256 pB = chef.pendingEco(1, alice);
        assertGt(pA, 0, "pool0 accrues");
        assertGt(pB, 0, "pool1 accrues");

        uint256 before = eco.balanceOf(alice);
        // harvest with NO intervening deposit/withdraw: must settle both pools
        chef.harvest();
        uint256 got = eco.balanceOf(alice) - before;
        assertApproxEqRel(got, pA + pB, 1e15);
        vm.stopPrank();
    }

    function test_PendingEcoIsPoolSpecific() public {
        chef = new OrbixMasterChef(address(eco), 10 ether, block.number + 1);
        vm.startPrank(minter);
        eco.mint(address(chef), 1_000_000 ether);
        vm.stopPrank();
        chef.add(100, IERC20(address(tokenA)));
        chef.add(100, IERC20(address(tokenB)));
        vm.roll(block.number + 2);
        vm.startPrank(alice);
        tokenA.approve(address(chef), type(uint256).max);
        chef.deposit(0, 10 ether);
        vm.roll(block.number + 50);
        // no stake in pool 1 -> pool 1 pending must be zero (not the global pending bucket)
        assertEq(chef.pendingEco(1, alice), 0, "empty pool pending must be 0");
        assertGt(chef.pendingEco(0, alice), 0);
        vm.stopPrank();
    }

    // ---------- EcoToken ----------
    function test_EcoMaxSupply() public {
        vm.startPrank(minter);
        eco.mint(address(1), 999_999_999 ether);
        vm.expectRevert(OrbixEcoToken.MaxSupplyExceeded.selector);
        eco.mint(address(1), 2 ether);
        vm.stopPrank();
        vm.expectRevert(OrbixEcoToken.NotMinter.selector);
        eco.mint(address(1), 1 ether);
    }

    receive() external payable {}
}
