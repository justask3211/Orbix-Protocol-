// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./OrbixRouter.sol";
import "./OrbixFactory.sol";

contract CurveToken is ERC20 {
    address public immutable curve;
    bool public transfersUnlocked;
    constructor(string memory n,string memory s,uint256 supply,address c) ERC20(n,s) { curve=c; _mint(c,supply); }
    function unlockTransfers() external { require(msg.sender==curve,"ONLY_CURVE"); transfersUnlocked=true; }
    function burnFromCurve(uint256 amount) external { require(msg.sender==curve,"ONLY_CURVE"); _burn(curve,amount); }
    function _update(address from,address to,uint256 value) internal override {
        if(!transfersUnlocked && from!=address(0) && from!=curve && to!=curve) revert("TRANSFER_LOCKED");
        super._update(from,to,value);
    }
}

contract OrbixLPLocker {
    using SafeERC20 for IERC20;
    IERC20 public immutable lpToken;
    address public immutable beneficiary;
    uint256 public immutable unlockAt;
    bool public released;
    constructor(address lp,address recipient,uint256 unlockTime) { lpToken=IERC20(lp); beneficiary=recipient; unlockAt=unlockTime; }
    function release() external {
        require(block.timestamp>=unlockAt,"LOCKED"); require(!released,"RELEASED"); released=true;
        lpToken.safeTransfer(beneficiary,lpToken.balanceOf(address(this)));
    }
}

contract OrbixBondingCurve is Ownable {
    using SafeERC20 for IERC20;
    uint256 public constant BPS=10_000;
    uint256 public immutable feeBps;
    uint256 public immutable graduationTarget;
    uint256 public immutable virtualQuote;
    uint256 public immutable virtualToken;
    uint256 public immutable tokenAllocation;
    address public immutable treasury;
    OrbixRouter public immutable router;
    OrbixFactory public immutable factory;
    CurveToken public immutable token;
    uint256 public raised;
    uint256 public tokensSold;
    uint256 public feeAccrued;
    bool public graduated;
    address public pair;
    address public lpLocker;
    uint256 private _entered;

    error Expired(); error Slippage(); error InvalidAmount(); error AlreadyGraduated(); error TargetExceeded(); error Reentrancy(); error TransferFailed();
    event Buy(address indexed buyer,uint256 quoteIn,uint256 tokensOut,uint256 fee,uint256 raisedTotal);
    event Sell(address indexed seller,uint256 tokensIn,uint256 quoteOut,uint256 fee,uint256 raisedTotal);
    event Graduated(address indexed pair,address indexed locker,uint256 quoteAmount,uint256 tokenAmount);
    modifier nonReentrant(){ if(_entered==1) revert Reentrancy(); _entered=1; _; _entered=0; }

    constructor(string memory n,string memory s,uint256 supply,uint256 allocation,uint256 target,uint256 vQuote,uint256 vToken,uint256 fee,address t,address f,address r) Ownable(msg.sender) {
        if(allocation==0||allocation>supply||target==0||vQuote==0||vToken<=allocation||fee>=1000||t==address(0)||f==address(0)||r==address(0)) revert InvalidAmount();
        tokenAllocation=allocation; graduationTarget=target; virtualQuote=vQuote; virtualToken=vToken; feeBps=fee; treasury=t;
        factory=OrbixFactory(f); router=OrbixRouter(payable(r)); token=new CurveToken(n,s,supply,address(this));
    }
    receive() external payable {}
    function quoteBuy(uint256 amountIn) public view returns(uint256 out,uint256 fee){
        if(amountIn==0||graduated||raised>=graduationTarget) return(0,0);
        uint256 remaining=graduationTarget-raised;
        uint256 net=amountIn-(amountIn*feeBps/BPS);
        if(net>remaining) { amountIn=_grossForNet(remaining); fee=amountIn*feeBps/BPS; net=amountIn-fee; }
        else fee=amountIn*feeBps/BPS;
        out=_buyOut(net);
        if(out>tokenAllocation-tokensSold) out=tokenAllocation-tokensSold;
    }
    function _buyOut(uint256 net) internal view returns(uint256){ return net*(virtualToken-tokensSold)/(virtualQuote+raised+net); }
    function _grossForNet(uint256 netAmount) internal view returns (uint256 gross) {
        gross = netAmount * BPS / (BPS - feeBps);
        while (gross - gross * feeBps / BPS < netAmount) ++gross;
        while (gross > 0 && (gross - 1) - (gross - 1) * feeBps / BPS >= netAmount) --gross;
    }
    function quoteSell(uint256 amountIn) public view returns(uint256 out,uint256 fee){
        if(amountIn==0||graduated||amountIn>tokensSold) return(0,0);
        uint256 gross=amountIn*(virtualQuote+raised)/(virtualToken-tokensSold+amountIn); fee=gross*feeBps/BPS; out=gross-fee;
    }
    function buy(uint256 minOut,uint256 deadline) external payable nonReentrant returns(uint256 out){
        if(block.timestamp>deadline) revert Expired(); if(graduated) revert AlreadyGraduated();
        uint256 accepted=msg.value; uint256 remaining=graduationTarget-raised;
        uint256 netGross=accepted-(accepted*feeBps/BPS);
        if(netGross>remaining) accepted=_grossForNet(remaining);
        uint256 fee; (out,fee)=quoteBuy(accepted); if(out<minOut||out==0) revert Slippage();
        uint256 net=accepted-fee; if(net>remaining) net=remaining;
        raised+=net; tokensSold+=out; feeAccrued+=fee;
        if(fee>0){ (bool ok,)=payable(treasury).call{value:fee}(""); if(!ok) revert TransferFailed(); }
        token.transfer(msg.sender,out); emit Buy(msg.sender,accepted,out,fee,raised);
        if(raised==graduationTarget) _graduate();
        uint256 refund=msg.value-accepted; if(refund>0){(bool ok,)=payable(msg.sender).call{value:refund}("");if(!ok) revert TransferFailed();}
    }
    function sell(uint256 amount,uint256 minOut,uint256 deadline) external nonReentrant returns(uint256 out){
        if(block.timestamp>deadline) revert Expired(); if(graduated) revert AlreadyGraduated();
        uint256 fee; (out,fee)=quoteSell(amount); if(out<minOut||out==0) revert Slippage();
        IERC20(address(token)).safeTransferFrom(msg.sender,address(this),amount); tokensSold-=amount; raised-=out+fee; feeAccrued+=fee;
        (bool ok,)=payable(msg.sender).call{value:out}("");if(!ok) revert TransferFailed();
        if(fee>0){(ok,)=payable(treasury).call{value:fee}("");if(!ok) revert TransferFailed();}
        emit Sell(msg.sender,amount,out,fee,raised);
    }
    function _graduate() internal {
        graduated=true; token.unlockTransfers();
        uint256 tokenAmount=virtualToken-tokensSold; uint256 balance=token.balanceOf(address(this));
        if(balance>tokenAmount) token.burnFromCurve(balance-tokenAmount);
        uint256 quoteAmount=raised;
        (bool ok,)=address(router.WETH()).call{value:quoteAmount}(abi.encodeWithSignature("deposit()"));if(!ok) revert TransferFailed();
        IERC20(address(token)).forceApprove(address(router),tokenAmount); IERC20(router.WETH()).forceApprove(address(router),quoteAmount);
        router.addLiquidity(address(token),router.WETH(),tokenAmount,quoteAmount,tokenAmount,quoteAmount,address(this),type(uint256).max);
        pair=factory.getPair(address(token),router.WETH());
        lpLocker=address(new OrbixLPLocker(pair,owner(),block.timestamp));
        IERC20(pair).safeTransfer(lpLocker,IERC20(pair).balanceOf(address(this)));
        emit Graduated(pair,lpLocker,quoteAmount,tokenAmount);
    }
}
