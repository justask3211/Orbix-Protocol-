// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "../src/OrbixBondingCurve.sol";
import "../src/OrbixFactory.sol";
import "../src/OrbixRouter.sol";
import "../src/OrbixPair.sol";
import "../src/WETH9.sol";

contract BondingCurveTest is Test {
    WETH9 weth; OrbixFactory factory; OrbixRouter router; OrbixBondingCurve curve;
    address alice=makeAddr("alice"); address bob=makeAddr("bob"); address treasury=makeAddr("treasury");
    function setUp() public {
        weth=new WETH9(); factory=new OrbixFactory(); router=new OrbixRouter(address(factory),address(weth));
        curve=new OrbixBondingCurve("Curve Asset","CRV",1_000_000 ether,500_000 ether,5 ether,10 ether,1_000_000 ether,100,treasury,address(factory),address(router));
        vm.deal(alice,100 ether); vm.deal(bob,100 ether);
    }
    function test_QuoteBuyPriceMovesUp() public {
        (uint256 first,)=curve.quoteBuy(1 ether);
        vm.prank(alice); curve.buy{value:1 ether}(first,block.timestamp+1 days);
        (uint256 second,)=curve.quoteBuy(1 ether);
        assertLt(second,first);
    }
    function test_QuoteExecutionAndSellRoundTrip() public {
        (uint256 out,)=curve.quoteBuy(1 ether);
        vm.prank(alice); assertEq(curve.buy{value:1 ether}(out,block.timestamp+1 days),out);
        uint256 before=alice.balance; (uint256 proceeds,)=curve.quoteSell(out/2);
        vm.startPrank(alice); CurveToken(address(curve.token())).approve(address(curve),out); assertEq(curve.sell(out/2,proceeds,block.timestamp+1 days),proceeds); vm.stopPrank();
        assertEq(alice.balance-before,proceeds);
        assertEq(address(curve).balance,curve.raised());
    }
    function test_TransferLockedBeforeGraduation() public {
        vm.prank(alice); curve.buy{value:1 ether}(1,block.timestamp+1 days);
        CurveToken curveToken = curve.token();
        vm.prank(alice); vm.expectRevert(bytes("TRANSFER_LOCKED")); curveToken.transfer(bob,1);
    }
    function test_ExpiredAndSlippageRevert() public {
        vm.prank(alice); vm.expectRevert(OrbixBondingCurve.Expired.selector); curve.buy{value:1 ether}(0,block.timestamp-1);
        vm.prank(alice); vm.expectRevert(OrbixBondingCurve.Slippage.selector); curve.buy{value:1 ether}(type(uint256).max,block.timestamp+1);
    }
    function test_OverTargetBuyRefundsExactNetAndRetainsOnlyDonation() public {
        vm.deal(address(this), 1 ether);
        (bool sent,) = address(curve).call{value: 1 ether}("");
        assertTrue(sent);
        uint256 before = alice.balance;
        (uint256 expectedOut,) = curve.quoteBuy(10 ether);
        vm.prank(alice); curve.buy{value: 10 ether}(expectedOut, block.timestamp + 1);
        assertEq(curve.raised(), curve.graduationTarget());
        assertEq(before - alice.balance, curve.graduationTarget() + curve.feeAccrued());
        assertEq(address(curve).balance, 1 ether);
    }
    function test_GraduationUsesReserveNotDonationAndLocksLP() public {
        vm.deal(address(this),1 ether); (bool sent,)=address(curve).call{value:1 ether}(""); assertTrue(sent);
        (uint256 out,)=curve.quoteBuy(10 ether);
        uint256 before=alice.balance;
        vm.prank(alice); curve.buy{value:10 ether}(out,block.timestamp+1);
        assertTrue(curve.graduated());
        assertEq(before-alice.balance,curve.graduationTarget()+curve.feeAccrued());
        assertEq(curve.token().balanceOf(alice),out);
        address pair=curve.pair(); assertTrue(pair!=address(0));
        address locker=curve.lpLocker(); assertGt(IERC20(pair).balanceOf(locker),0);
        assertEq(IERC20(pair).balanceOf(address(curve)),0);
        (uint112 r0,uint112 r1,)=OrbixPair(pair).getReserves();
        uint256 quoteRes=OrbixPair(pair).token0()==address(weth)?r0:r1;
        uint256 tokenRes=OrbixPair(pair).token0()==address(weth)?r1:r0;
        assertEq(quoteRes,curve.graduationTarget());
        assertEq(tokenRes,curve.virtualToken()-curve.tokensSold());
        CurveToken curveToken = curve.token();
        vm.prank(alice); curveToken.transfer(bob,1);
        vm.prank(alice); vm.expectRevert(OrbixBondingCurve.AlreadyGraduated.selector); curve.buy{value:1 ether}(0,block.timestamp+1);
    }
    receive() external payable {}
}
