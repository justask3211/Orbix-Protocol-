// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./OrbixFactory.sol";
import "./OrbixRouter.sol";
import "./OrbixPair.sol";

/// @title OrbixLaunchpad
/// @notice Permissionless ecosystem-token creation with explicit collateral and LP lifecycle.
/// A launch creates a mintable ERC20, accepts a declared collateral token, and optionally seeds
/// the Orbix AMM. This is intentionally a fixed-supply sale primitive, not a fake bonding curve.
contract OrbixLaunchpad is Ownable {
    using SafeERC20 for IERC20;

    struct Launch {
        address creator;
        address token;
        address collateral;
        address pair;
        uint256 tokenSupply;
        uint256 collateralSeed;
        uint256 tokenSeed;
        uint256 createdAt;
        bool active;
        bool liquidityLocked;
    }

    OrbixFactory public immutable factory;
    OrbixRouter public immutable router;
    mapping(address => bool) public collateralAllowed;
    mapping(address => Launch) public launches;
    address[] public allLaunchTokens;
    uint256 public immutable creationFee;
    address public feeTreasury;
    uint256 public liquidityLockPeriod;

    error ZeroAddress();
    error InvalidAmount();
    error CollateralNotAllowed();
    error AlreadyLaunched();
    error NotCreator();
    error Inactive();
    error LockActive();
    error NativeFeeRequired();

    event CollateralSet(address indexed token, bool allowed);
    event LaunchCreated(address indexed creator, address indexed token, address indexed collateral, address pair, uint256 supply, uint256 collateralSeed, uint256 tokenSeed);
    event LiquidityLocked(address indexed token, uint256 unlockAt);
    event LaunchClosed(address indexed token);

    constructor(address _factory, address _router, address _treasury, uint256 _creationFee, uint256 _lockPeriod)
        Ownable(msg.sender)
    {
        if (_factory == address(0) || _router == address(0) || _treasury == address(0)) revert ZeroAddress();
        factory = OrbixFactory(_factory);
        router = OrbixRouter(payable(_router));
        feeTreasury = _treasury;
        creationFee = _creationFee;
        liquidityLockPeriod = _lockPeriod;
    }

    function setCollateral(address token, bool allowed) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        collateralAllowed[token] = allowed;
        emit CollateralSet(token, allowed);
    }

    function createLaunch(
        string calldata name,
        string calldata symbol,
        uint256 supply,
        address collateral,
        uint256 tokenSeed,
        uint256 collateralSeed,
        bool lockLiquidity
    ) external payable returns (address token, address pair) {
        if (msg.value != creationFee) revert NativeFeeRequired();
        if (supply == 0 || tokenSeed == 0 || collateralSeed == 0) revert InvalidAmount();
        if (!collateralAllowed[collateral]) revert CollateralNotAllowed();
        if (launches[msg.sender].token != address(0)) revert AlreadyLaunched();
        if (collateral == address(0)) revert ZeroAddress();

        LaunchToken created = new LaunchToken(name, symbol, supply, address(this));
        token = address(created);
        // Collateral is pulled from the creator; the launch token is minted directly to this
        // launchpad so the pair seeding is atomic and cannot be griefed by a missing approval.
        IERC20(collateral).safeTransferFrom(msg.sender, address(this), collateralSeed);

        IERC20(token).forceApprove(address(router), type(uint256).max);
        IERC20(collateral).forceApprove(address(router), type(uint256).max);
        (,,uint256 liquidity) = router.addLiquidity(token, collateral, tokenSeed, collateralSeed, tokenSeed, collateralSeed, address(this), type(uint256).max);
        // Return whatever was not consumed by the pair (e.g. rounding leftovers) to the creator.
        IERC20(token).safeTransfer(msg.sender, IERC20(token).balanceOf(address(this)));
        IERC20(collateral).safeTransfer(msg.sender, IERC20(collateral).balanceOf(address(this)));
        pair = factory.getPair(token, collateral);
        if (liquidity == 0 || pair == address(0)) revert InvalidAmount();
        OrbixPair(pair).approve(address(this), liquidity);
        // Liquidity remains escrowed in this launchpad until its lock period ends.
        launches[msg.sender] = Launch({creator: msg.sender, token: token, collateral: collateral, pair: pair,
            tokenSupply: supply, collateralSeed: collateralSeed, tokenSeed: tokenSeed, createdAt: block.timestamp,
            active: true, liquidityLocked: lockLiquidity});
        allLaunchTokens.push(token);
        if (!lockLiquidity) _releaseLiquidity(msg.sender);
        emit LaunchCreated(msg.sender, token, collateral, pair, supply, collateralSeed, tokenSeed);
        return (token, pair);
    }

    function closeLaunch() external {
        Launch storage l = launches[msg.sender];
        if (!l.active) revert Inactive();
        if (l.creator != msg.sender) revert NotCreator();
        l.active = false;
        if (l.liquidityLocked) {
            if (block.timestamp < l.createdAt + liquidityLockPeriod) revert LockActive();
            _releaseLiquidity(msg.sender);
        }
        emit LaunchClosed(l.token);
    }

    function _releaseLiquidity(address creator) internal {
        Launch storage l = launches[creator];
        uint256 lp = IERC20(l.pair).balanceOf(address(this));
        if (lp > 0) IERC20(l.pair).safeTransfer(creator, lp);
        l.liquidityLocked = false;
        emit LiquidityLocked(l.token, block.timestamp);
    }

    function withdrawFees() external onlyOwner {
        (bool ok,) = payable(feeTreasury).call{value: address(this).balance}("");
        require(ok);
    }
}

contract LaunchToken is ERC20 {
    constructor(string memory name_, string memory symbol_, uint256 supply, address recipient)
        ERC20(name_, symbol_) { _mint(recipient, supply); }
}
