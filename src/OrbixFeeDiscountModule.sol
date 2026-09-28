// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title OrbixFeeDiscountModule — swap fee rebate for Orbix666 holders.
/// Users swap via the standard OrbixRouter, then claim a rebate matching their discount.
/// Keeps the battle-tested Router immutable while still delivering the holder perk.
interface IOrbix666 {
    function feeDiscountBps(address holder) external view returns (uint256);
}
interface IECO {
    function transfer(address to, uint256 amount) external returns (bool);
}

contract OrbixFeeDiscountModule {
    IOrbix666 public immutable nft;
    IECO public immutable eco;
    address public operator;

    mapping(address => uint256) public pendingRebate;
    uint256 public totalRebated;

    event RebateAccrued(address indexed holder, uint256 amount);
    event RebateClaimed(address indexed holder, uint256 amount);

    error NotOperator();
    error NothingPending();

    modifier onlyOperator() { if (msg.sender != operator) revert NotOperator(); _; }

    constructor(address _nft, address _eco) {
        nft = IOrbix666(_nft);
        eco = IECO(_eco);
        operator = msg.sender;
    }

    /// @notice accrue rebate for a swap: inputAmount, discountBps (e.g. 2500 = 25%), fee 0.3%
    function accrue(address holder, uint256 swapAmountIn) external onlyOperator {
        uint256 discount = nft.feeDiscountBps(holder);
        if (discount == 0 || swapAmountIn == 0) return;
        uint256 feePaid = swapAmountIn * 3 / 1000;
        uint256 rebate = feePaid * discount / 10_000;
        pendingRebate[holder] += rebate;
        emit RebateAccrued(holder, rebate);
    }

    function claim() external {
        uint256 amt = pendingRebate[msg.sender];
        if (amt == 0) revert NothingPending();
        pendingRebate[msg.sender] = 0;
        totalRebated += amt;
        eco.transfer(msg.sender, amt);
        emit RebateClaimed(msg.sender, amt);
    }

    function setOperator(address o) external onlyOperator { operator = o; }
}
