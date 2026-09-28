// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title OrbixMasterChef — stake LP tokens or ECO token, earn ORBIX-ECO rewards per block.
contract OrbixMasterChef is Ownable {
    using SafeERC20 for IERC20;

    struct Pool {
        IERC20 stakingToken;
        uint256 allocPoint;
        uint256 lastRewardBlock;
        uint256 accEcoPerShare;
    }

    Pool[] public poolInfo;
    mapping(address => mapping(uint256 => uint256)) public staked; // user => poolId => amount
    mapping(address => mapping(uint256 => uint256)) public rewardDebt;
    mapping(address => uint256) public pendingRewards;

    address public ecoToken;
    uint256 public ecoPerBlock;
    uint256 public totalAllocPoint;
    uint256 public immutable START_BLOCK;

    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event Harvest(address indexed user, uint256 amount);

    error PoolExists();
    error NothingStaked();

    constructor(address _ecoToken, uint256 _ecoPerBlock, uint256 startBlock) Ownable(msg.sender) {
        ecoToken = _ecoToken;
        ecoPerBlock = _ecoPerBlock;
        START_BLOCK = startBlock;
    }

    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    function add(uint256 allocPoint, IERC20 stakingToken) external onlyOwner {
        if (_poolExists(address(stakingToken))) revert PoolExists();
        uint256 lastRewardBlock = block.number > START_BLOCK ? block.number : START_BLOCK;
        totalAllocPoint += allocPoint;
        poolInfo.push(Pool({stakingToken: stakingToken, allocPoint: allocPoint, lastRewardBlock: lastRewardBlock, accEcoPerShare: 0}));
    }

    function _poolExists(address token) internal view returns (bool) {
        for (uint256 i = 0; i < poolInfo.length; i++) {
            if (address(poolInfo[i].stakingToken) == token) return true;
        }
        return false;
    }

    function pendingEco(uint256 pid, address user) external view returns (uint256) {
        Pool storage pool = poolInfo[pid];
        uint256 accEcoPerShare = pool.accEcoPerShare;
        uint256 stakedTotal = _poolStaked(pid);
        if (block.number > pool.lastRewardBlock && stakedTotal > 0) {
            uint256 blocks = block.number - pool.lastRewardBlock;
            uint256 ecoReward = blocks * ecoPerBlock * pool.allocPoint / totalAllocPoint;
            accEcoPerShare += ecoReward * 1e12 / stakedTotal;
        }
        uint256 userStaked = staked[user][pid];
        return userStaked * accEcoPerShare / 1e12 - rewardDebt[user][pid] + pendingRewards[user];
    }

    // Tracks staked totals per pool using balance deltas (no double storage cost)
    mapping(uint256 => uint256) private poolStakedTotal;

    function _poolStaked(uint256 pid) internal view returns (uint256) {
        return poolStakedTotal[pid];
    }

    function deposit(uint256 pid, uint256 amount) external {
        Pool storage pool = poolInfo[pid];
        _updatePool(pid);
        if (amount > 0) {
            uint256 before = pool.stakingToken.balanceOf(address(this));
            SafeERC20.safeTransferFrom(pool.stakingToken, msg.sender, address(this), amount);
            uint256 after_ = pool.stakingToken.balanceOf(address(this));
            uint256 actual = after_ - before; // fee-on-transfer safe
            poolStakedTotal[pid] += actual;
            uint256 pending = staked[msg.sender][pid] * pool.accEcoPerShare / 1e12 - rewardDebt[msg.sender][pid];
            if (pending > 0) pendingRewards[msg.sender] += pending;
            staked[msg.sender][pid] += actual;
            rewardDebt[msg.sender][pid] = staked[msg.sender][pid] * pool.accEcoPerShare / 1e12;
        }
        emit Deposit(msg.sender, pid, amount);
    }

    function withdraw(uint256 pid, uint256 amount) external {
        Pool storage pool = poolInfo[pid];
        _updatePool(pid);
        uint256 userAmt = staked[msg.sender][pid];
        if (amount > userAmt) amount = userAmt;
        if (amount == 0) revert NothingStaked();
        uint256 pending = staked[msg.sender][pid] * pool.accEcoPerShare / 1e12 - rewardDebt[msg.sender][pid];
        if (pending > 0) pendingRewards[msg.sender] += pending;
        staked[msg.sender][pid] -= amount;
        poolStakedTotal[pid] -= amount;
        rewardDebt[msg.sender][pid] = staked[msg.sender][pid] * pool.accEcoPerShare / 1e12;
        SafeERC20.safeTransfer(pool.stakingToken, msg.sender, amount);
        emit Withdraw(msg.sender, pid, amount);
    }

    function harvest() external {
        Pool storage pool = poolInfo[0];
        _updatePool(0);
        uint256 total = 0;
        for (uint256 pid = 0; pid < poolInfo.length; pid++) {
            Pool storage p = poolInfo[pid];
            total += staked[msg.sender][pid] * p.accEcoPerShare / 1e12 - rewardDebt[msg.sender][pid];
            rewardDebt[msg.sender][pid] = staked[msg.sender][pid] * p.accEcoPerShare / 1e12;
        }
        total += pendingRewards[msg.sender];
        pendingRewards[msg.sender] = 0;
        if (total > 0) {
            SafeERC20.safeTransfer(IERC20(ecoToken), msg.sender, total);
            emit Harvest(msg.sender, total);
        }
    }

    function _updatePool(uint256 pid) internal {
        Pool storage pool = poolInfo[pid];
        if (block.number <= pool.lastRewardBlock) return;
        uint256 stakedTotal = poolStakedTotal[pid];
        if (stakedTotal == 0) {
            pool.lastRewardBlock = block.number;
            return;
        }
        uint256 blocks = block.number - pool.lastRewardBlock;
        uint256 ecoReward = blocks * ecoPerBlock * pool.allocPoint / totalAllocPoint;
        pool.accEcoPerShare += ecoReward * 1e12 / stakedTotal;
        pool.lastRewardBlock = block.number;
    }

    function setEcoPerBlock(uint256 _ecoPerBlock) external onlyOwner {
        ecoPerBlock = _ecoPerBlock;
    }
}
