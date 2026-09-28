// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./OrbixFactory.sol";
import "./OrbixRouter.sol";
import "./OrbixPair.sol";

/// @title OrbixLaunchpad
/// @notice Permissionless launches using owner-governed approved collateral.
/// Collateral is never accepted merely because it was launched: governance must explicitly allow it.
contract OrbixLaunchpad is Ownable, ReentrancyGuard {
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
    /// @dev Compatibility view: points to the creator's most recent launch.
    mapping(address => Launch) public launches;
    mapping(uint256 => Launch) private _launches;
    mapping(address => uint256[]) private _creatorLaunchIds;
    mapping(address => uint256) public tokenLaunchId;
    mapping(uint256 => uint256) public launchLp;
    address[] public allLaunchTokens;
    uint256 public immutable creationFee;
    address public feeTreasury;
    uint256 public liquidityLockPeriod;
    uint256 public nextLaunchId = 1;

    error ZeroAddress();
    error InvalidAmount();
    error InvalidMetadata();
    error CollateralNotAllowed();
    error Inactive();
    error LockActive();
    error NativeFeeRequired();
    error InvalidToken();
    error TransferAmountMismatch();
    error NotCreator();

    event CollateralSet(address indexed token, bool allowed);
    event LaunchCreated(uint256 indexed launchId, address indexed creator, address indexed token, address collateral, address pair, uint256 supply, uint256 collateralSeed, uint256 tokenSeed, bytes32 metadataHash);
    event LiquidityLocked(uint256 indexed launchId, address indexed token, uint256 unlockAt);
    event LaunchClosed(uint256 indexed launchId, address indexed token);

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
        if (token.code.length == 0) revert InvalidToken();
        collateralAllowed[token] = allowed;
        emit CollateralSet(token, allowed);
    }

    function creatorLaunchCount(address creator) external view returns (uint256) { return _creatorLaunchIds[creator].length; }
    function creatorLaunchIds(address creator, uint256 index) external view returns (uint256) { return _creatorLaunchIds[creator][index]; }
    function getLaunch(uint256 launchId) external view returns (Launch memory) { return _launches[launchId]; }

    function createLaunch(string calldata name, string calldata symbol, uint256 supply, address collateral, uint256 tokenSeed, uint256 collateralSeed, bool lockLiquidity)
        external payable nonReentrant returns (address token, address pair)
    {
        return _createLaunch(name, symbol, supply, collateral, tokenSeed, collateralSeed, lockLiquidity, bytes32(0));
    }

    function createLaunchWithMetadata(string calldata name, string calldata symbol, uint256 supply, address collateral, uint256 tokenSeed, uint256 collateralSeed, bool lockLiquidity, bytes32 metadataHash)
        external payable nonReentrant returns (address token, address pair)
    {
        if (metadataHash == bytes32(0)) revert InvalidMetadata();
        return _createLaunch(name, symbol, supply, collateral, tokenSeed, collateralSeed, lockLiquidity, metadataHash);
    }

    function _createLaunch(string calldata name, string calldata symbol, uint256 supply, address collateral, uint256 tokenSeed, uint256 collateralSeed, bool lockLiquidity, bytes32 metadataHash)
        internal returns (address token, address pair)
    {
        if (msg.value != creationFee) revert NativeFeeRequired();
        if (bytes(name).length == 0 || bytes(symbol).length == 0 || bytes(name).length > 64 || bytes(symbol).length > 16) revert InvalidMetadata();
        if (supply == 0 || tokenSeed == 0 || tokenSeed > supply || collateralSeed == 0) revert InvalidAmount();
        if (collateral == address(0)) revert ZeroAddress();
        if (collateral.code.length == 0) revert InvalidToken();
        if (!collateralAllowed[collateral]) revert CollateralNotAllowed();

        LaunchToken created = new LaunchToken(name, symbol, supply, address(this));
        token = address(created);
        uint256 liquidity = _seedPool(token, collateral, tokenSeed, collateralSeed, supply, msg.sender);
        pair = factory.getPair(token, collateral);
        if (pair == address(0)) revert InvalidAmount();

        _recordLaunch(msg.sender, token, collateral, pair, supply, collateralSeed, tokenSeed, lockLiquidity, metadataHash);
        return (token, pair);
    }

    function _recordLaunch(address creator, address token, address collateral, address pair, uint256 supply, uint256 collateralSeed, uint256 tokenSeed, bool lockLiquidity, bytes32 metadataHash) internal {
        uint256 id = nextLaunchId++;
        Launch memory l = Launch(creator, token, collateral, pair, supply, collateralSeed, tokenSeed, block.timestamp, true, lockLiquidity);
        _launches[id] = l;
        launches[creator] = l;
        _creatorLaunchIds[creator].push(id);
        tokenLaunchId[token] = id;
        launchLp[id] = IERC20(pair).balanceOf(address(this));
        allLaunchTokens.push(token);
        if (!lockLiquidity) _releaseLiquidity(id);
        emit LaunchCreated(id, creator, token, collateral, pair, supply, collateralSeed, tokenSeed, metadataHash);
    }

    function _seedPool(address token, address collateral, uint256 tokenSeed, uint256 collateralSeed, uint256 supply, address creator) internal returns (uint256 liquidity) {
        uint256 beforeCollateral = IERC20(collateral).balanceOf(address(this));
        IERC20(collateral).safeTransferFrom(creator, address(this), collateralSeed);
        if (IERC20(collateral).balanceOf(address(this)) - beforeCollateral != collateralSeed) revert TransferAmountMismatch();
        IERC20(token).forceApprove(address(router), tokenSeed);
        IERC20(collateral).forceApprove(address(router), collateralSeed);
        (uint256 usedToken, uint256 usedCollateral, uint256 minted) = router.addLiquidity(token, collateral, tokenSeed, collateralSeed, tokenSeed, collateralSeed, address(this), block.timestamp);
        liquidity = minted;
        IERC20(token).forceApprove(address(router), 0);
        IERC20(collateral).forceApprove(address(router), 0);
        if (liquidity == 0 || usedToken != tokenSeed || usedCollateral != collateralSeed) revert TransferAmountMismatch();
        IERC20(token).safeTransfer(creator, supply - tokenSeed);
        if (IERC20(token).balanceOf(address(this)) != 0 || IERC20(collateral).balanceOf(address(this)) != beforeCollateral) revert TransferAmountMismatch();
    }

    function closeLaunch() external { closeLaunch(_creatorLaunchIds[msg.sender][_creatorLaunchIds[msg.sender].length - 1]); }

    function closeLaunch(uint256 launchId) public nonReentrant {
        Launch storage l = _launches[launchId];
        if (l.creator != msg.sender) revert NotCreator();
        if (!l.active) revert Inactive();
        if (l.liquidityLocked && block.timestamp < l.createdAt + liquidityLockPeriod) revert LockActive();
        l.active = false;
        launches[msg.sender] = l;
        if (l.liquidityLocked) _releaseLiquidity(launchId);
        emit LaunchClosed(launchId, l.token);
    }

    function _releaseLiquidity(uint256 launchId) internal {
        Launch storage l = _launches[launchId];
        uint256 lp = launchLp[launchId];
        if (lp > 0) IERC20(l.pair).safeTransfer(l.creator, lp);
        launchLp[launchId] = 0;
        l.liquidityLocked = false;
        launches[l.creator] = l;
        emit LiquidityLocked(launchId, l.token, block.timestamp);
    }

    function withdrawFees() external onlyOwner {
        (bool ok,) = payable(feeTreasury).call{value: address(this).balance}("");
        require(ok);
    }
}

contract LaunchToken is ERC20 {
    constructor(string memory name_, string memory symbol_, uint256 supply, address recipient) ERC20(name_, symbol_) { _mint(recipient, supply); }
}
