// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/// @title RewardEngine
/// @notice Universal reward pool for Orbix Center. One contract handles all
///         reward types (ERC-20 / ERC-721 / ERC-1155 / ETH) and all claim
///         modes (auto-push, claim-code, Merkle-proof, first-N).
///
///   Creator creates a pool for a room:
///     - deposits assets (token / NFT / 1155 / ETH)
///     - sets claim mode + deadline + allocations
///   Winners claim:
///     - AUTO: pushed by the settlement authority at settlement time
///     - CODE: winner pastes a signed claim code (wallet-bound)
///     - MERKLE: winner submits a Merkle proof (for custom distributions)
///     - OPEN: first N wallets to claim get the allocation
///   After the deadline, the creator reclaims unclaimed assets.
///
///   Private-key delivery is not implemented. This contract only transfers
///   assets to addresses; it never creates, stores or delivers private keys.
contract RewardEngine is ReentrancyGuard, IERC721Receiver, IERC1155Receiver {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // ------------------------------------------------------------ types

    enum AssetKind {
        ERC20,
        ERC721,
        ERC1155,
        ETH
    }
    enum ClaimMode {
        Auto,
        Code,
        Merkle,
        Open
    }
    enum PoolState {
        Active,
        Settled,
        Expired
    }

    struct Asset {
        AssetKind kind;
        address contractAddr; // zero for ETH
        uint256 tokenId; // 0 for ERC20/ETH
        uint256 amount; // ERC20 amount, 1155 amount, 1 for 721, ETH wei
    }

    struct Allocation {
        address winner; // zero for OPEN mode
        uint256 assetIndex; // index into the pool's asset array
        uint256 subAmount; // partial fungible amount; 1 for ERC721 (ID is in Asset)
        bool claimed;
    }

    struct Pool {
        address creator;
        bytes32 roomId;
        ClaimMode mode;
        uint64 claimDeadline;
        uint32 maxOpenClaims; // for OPEN mode
        uint32 openClaimed;
        PoolState state;
        bool exists;
        bytes32 merkleRoot; // for Merkle mode
        Asset[] assets;
        // allocations indexed by claim slot
        mapping(uint256 => Allocation) allocations;
        uint256 allocationCount;
        // per-claimant tracking (wallet-bound code / Merkle)
        mapping(address => bool) claimedBy;
        // committed tracking: token => amount (never sweepable)
        mapping(address => uint256) tokenCommitted;
        mapping(uint256 => bool) nftCommitted;
        // custom message (off-chain display)
        string message;
    }

    address public authority; // settlement signer
    mapping(uint256 => Pool) public pools;
    // roomId => list of pool ids
    mapping(bytes32 => uint256[]) public roomPools;
    uint256 public poolCount;
    // Outstanding Code/Open allocations reserve inventory per asset, per pool.
    mapping(uint256 => mapping(uint256 => uint256)) public reserved;
    address private receivingToken;
    address private receivingFrom;
    uint256 private receivingId;
    uint256 private receivingAmount;

    event PoolCreated(
        uint256 indexed poolId,
        bytes32 indexed roomId,
        address indexed creator,
        uint8 claimMode,
        uint64 deadline,
        uint256 assetCount
    );
    event AssetDeposited(
        uint256 indexed poolId, uint8 kind, address indexed contractAddr, uint256 tokenId, uint256 amount
    );
    event AllocationSet(uint256 indexed poolId, address indexed winner, uint256 assetIndex, uint256 subAmount);
    event RewardClaimed(uint256 indexed poolId, address indexed claimant, uint256 assetIndex, uint256 subAmount);
    event AutoPush(uint256 indexed poolId, address indexed winner, uint256 assetIndex);
    event PoolExpired(uint256 indexed poolId);
    event Reclaimed(uint256 indexed poolId, address indexed creator, uint8 kind, uint256 tokenId, uint256 amount);
    event MessageSet(uint256 indexed poolId, string message);

    error NotCreator();
    error NotAuthority();
    error PoolNotFound();
    error AlreadyExists();
    error DeadlinePassed();
    error DeadlineTooSoon();
    error AlreadyClaimed();
    error AlreadySettled();
    error NotWinner();
    error BadMerkleProof();
    error OpenClaimsExhausted();
    error ZeroAmount();
    error ZeroAddress();
    error WrongAssetKind();
    error NothingToReclaim();
    error NotExpired();
    error EmptyMessage();
    error AlreadySet();
    error BadAllocation();
    error UnexpectedReceipt();
    error TransferMismatch();

    modifier onlyCreator(uint256 poolId) {
        if (pools[poolId].creator != msg.sender) revert NotCreator();
        _;
    }

    constructor(address _authority) {
        if (_authority == address(0)) revert ZeroAddress();
        authority = _authority;
    }

    /// @dev EIP-191 personal-sign digest, matching eth_account / wallet signing.
    function _ethSigned(bytes32 h) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h));
    }

    // ------------------------------------------------------------ pool creation

    function createPool(
        bytes32 roomId,
        ClaimMode mode,
        uint64 claimDeadline,
        uint32 maxOpenClaims,
        bytes32 merkleRoot,
        string calldata message
    ) external returns (uint256 poolId) {
        if (claimDeadline <= block.timestamp + 1 hours) revert DeadlineTooSoon();
        if (mode == ClaimMode.Open && maxOpenClaims == 0) revert BadAllocation();
        if (mode == ClaimMode.Merkle && merkleRoot == bytes32(0)) revert BadMerkleProof();
        poolId = poolCount++;
        Pool storage p = pools[poolId];
        p.creator = msg.sender;
        p.roomId = roomId;
        p.mode = mode;
        p.claimDeadline = claimDeadline;
        p.maxOpenClaims = maxOpenClaims;
        p.state = PoolState.Active;
        p.exists = true;
        p.merkleRoot = merkleRoot;
        if (bytes(message).length > 0) p.message = message;
        roomPools[roomId].push(poolId);
        emit PoolCreated(poolId, roomId, msg.sender, uint8(mode), claimDeadline, 0);
    }

    // ------------------------------------------------------------ asset deposit

    function depositERC20(uint256 poolId, address token, uint256 amount) external nonReentrant onlyCreator(poolId) {
        Pool storage p = _active(poolId);
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - before;
        if (received != amount) revert ZeroAmount(); // fee-on-transfer reject
        p.assets.push(Asset(AssetKind.ERC20, token, 0, received));
        p.tokenCommitted[token] += received;
        emit AssetDeposited(poolId, uint8(AssetKind.ERC20), token, 0, received);
    }

    function depositERC721(uint256 poolId, address token, uint256 tokenId) external nonReentrant onlyCreator(poolId) {
        _active(poolId);
        if (token.code.length == 0) revert WrongAssetKind();
        receivingToken = token; receivingFrom = msg.sender; receivingId = tokenId; receivingAmount = 1;
        IERC721(token).safeTransferFrom(msg.sender, address(this), tokenId);
        receivingToken = address(0);
        if (IERC721(token).ownerOf(tokenId) != address(this)) revert TransferMismatch();
        pools[poolId].assets.push(Asset(AssetKind.ERC721, token, tokenId, 1));
        pools[poolId].nftCommitted[tokenId] = true;
        emit AssetDeposited(poolId, uint8(AssetKind.ERC721), token, tokenId, 1);
    }

    function depositERC1155(uint256 poolId, address token, uint256 tokenId, uint256 amount, bytes calldata data)
        external
        nonReentrant
        onlyCreator(poolId)
    {
        _active(poolId);
        if (token.code.length == 0) revert WrongAssetKind();
        if (amount == 0) revert ZeroAmount();
        uint256 before = IERC1155(token).balanceOf(address(this), tokenId);
        receivingToken = token; receivingFrom = msg.sender; receivingId = tokenId; receivingAmount = amount;
        IERC1155(token).safeTransferFrom(msg.sender, address(this), tokenId, amount, data);
        receivingToken = address(0);
        if (IERC1155(token).balanceOf(address(this), tokenId) - before != amount) revert TransferMismatch();
        pools[poolId].assets.push(Asset(AssetKind.ERC1155, token, tokenId, amount));
        pools[poolId].tokenCommitted[token] += amount;
        emit AssetDeposited(poolId, uint8(AssetKind.ERC1155), token, tokenId, amount);
    }

    function depositETH(uint256 poolId) external payable nonReentrant onlyCreator(poolId) {
        _active(poolId);
        if (msg.value == 0) revert ZeroAmount();
        pools[poolId].assets.push(Asset(AssetKind.ETH, address(0), 0, msg.value));
        pools[poolId].tokenCommitted[address(0)] += msg.value;
        emit AssetDeposited(poolId, uint8(AssetKind.ETH), address(0), 0, msg.value);
    }

    // ------------------------------------------------------------ allocations

    function setAllocation(uint256 poolId, address winner, uint256 assetIndex, uint256 subAmount)
        external
        nonReentrant
        onlyCreator(poolId)
    {
        Pool storage p = _active(poolId);
        if (p.mode != ClaimMode.Code && p.mode != ClaimMode.Open) revert WrongAssetKind();
        if (assetIndex >= p.assets.length) revert WrongAssetKind();
        if (p.mode == ClaimMode.Open ? winner != address(0) : winner == address(0)) revert NotWinner();
        if (p.mode == ClaimMode.Open && p.allocationCount >= p.maxOpenClaims) revert OpenClaimsExhausted();
        Asset storage a = p.assets[assetIndex];
        if (subAmount == 0 || a.kind == AssetKind.ERC721 && subAmount != 1) revert BadAllocation();
        if (reserved[poolId][assetIndex] + subAmount > a.amount) revert BadAllocation();
        reserved[poolId][assetIndex] += subAmount;
        p.allocations[p.allocationCount] = Allocation(winner, assetIndex, subAmount, false);
        emit AllocationSet(poolId, winner, assetIndex, subAmount);
        p.allocationCount++;
    }

    function setMessage(uint256 poolId, string calldata message) external onlyCreator(poolId) {
        pools[poolId].message = message;
        emit MessageSet(poolId, message);
    }

    // ------------------------------------------------------------ claims

    /// @notice AUTO mode: authority pushes rewards at settlement. No claim needed.
    function autoPush(
        uint256 poolId,
        address[] calldata winners,
        uint256[] calldata assetIndices,
        bytes calldata signature
    ) external nonReentrant {
        Pool storage p = _active(poolId);
        if (winners.length == 0 || winners.length != assetIndices.length) revert BadAllocation();
        if (p.mode != ClaimMode.Auto) revert WrongAssetKind();
        if (p.state != PoolState.Active) revert AlreadySettled();
        bytes32 digest = keccak256(
            abi.encodePacked(
                "ORBIX_REWARD_AUTOPUSH_V1",
                address(this),
                block.chainid,
                poolId,
                keccak256(abi.encode(winners, assetIndices))
            )
        );
        if (ECDSA.recover(_ethSigned(digest), signature) != authority) revert NotAuthority();
        for (uint256 i; i < winners.length; ++i) {
            _transferAsset(poolId, assetIndices[i], winners[i], p.assets[assetIndices[i]].amount);
            emit AutoPush(poolId, winners[i], assetIndices[i]);
        }
        p.state = PoolState.Settled;
    }

    /// @notice CODE mode: winner pastes a signed claim code (wallet-bound, one-time).
    function claimByCode(uint256 poolId, uint256 allocIndex, uint256 nonce, bytes calldata signature)
        external
        nonReentrant
    {
        Pool storage p = _active(poolId);
        if (p.mode != ClaimMode.Code) revert WrongAssetKind();
        if (block.timestamp > p.claimDeadline) revert DeadlinePassed();
        if (allocIndex >= p.allocationCount) revert BadAllocation();
        Allocation storage alloc = p.allocations[allocIndex];
        if (alloc.claimed) revert AlreadyClaimed();
        if (alloc.winner != msg.sender) revert NotWinner();
        // one-time signed code from the authority binds (pool, claimant, allocation, nonce)
        bytes32 digest = keccak256(
            abi.encodePacked(
                "ORBIX_REWARD_CLAIM_V1", address(this), block.chainid, poolId, allocIndex, msg.sender, nonce
            )
        );
        if (ECDSA.recover(_ethSigned(digest), signature) != authority) revert NotAuthority();
        alloc.claimed = true;
        reserved[poolId][alloc.assetIndex] -= alloc.subAmount;
        p.claimedBy[msg.sender] = true;
        _transferAsset(poolId, alloc.assetIndex, msg.sender, alloc.subAmount);
        emit RewardClaimed(poolId, msg.sender, alloc.assetIndex, alloc.subAmount);
    }

    /// @notice MERKLE mode: winner submits a proof against the committed root.
    function claimByMerkle(
        uint256 poolId,
        bytes32[] calldata proof,
        address winner,
        uint256 assetIndex,
        uint256 subAmount
    ) external nonReentrant {
        Pool storage p = _active(poolId);
        if (p.mode != ClaimMode.Merkle) revert WrongAssetKind();
        if (block.timestamp > p.claimDeadline) revert DeadlinePassed();
        if (winner != msg.sender || winner == address(0)) revert NotWinner();
        if (p.claimedBy[winner]) revert AlreadyClaimed();
        bytes32 leaf = keccak256(abi.encodePacked(winner, assetIndex, subAmount));
        if (!MerkleProof.verify(proof, p.merkleRoot, leaf)) revert BadMerkleProof();
        p.claimedBy[winner] = true;
        _transferAsset(poolId, assetIndex, winner, subAmount);
        emit RewardClaimed(poolId, winner, assetIndex, subAmount);
    }

    /// @notice OPEN mode: first N wallets to claim.
    function claimOpen(uint256 poolId, uint256 allocIndex) external nonReentrant {
        Pool storage p = _active(poolId);
        if (p.mode != ClaimMode.Open) revert WrongAssetKind();
        if (block.timestamp > p.claimDeadline) revert DeadlinePassed();
        if (p.claimedBy[msg.sender]) revert AlreadyClaimed();
        if (p.openClaimed >= p.maxOpenClaims) revert OpenClaimsExhausted();
        if (allocIndex >= p.allocationCount) revert BadAllocation();
        Allocation storage alloc = p.allocations[allocIndex];
        if (alloc.claimed) revert AlreadyClaimed();
        if (alloc.winner != address(0)) revert NotWinner(); // OPEN allocations have zero winner
        alloc.winner = msg.sender;
        alloc.claimed = true;
        reserved[poolId][alloc.assetIndex] -= alloc.subAmount;
        p.openClaimed++;
        p.claimedBy[msg.sender] = true;
        _transferAsset(poolId, alloc.assetIndex, msg.sender, alloc.subAmount);
        emit RewardClaimed(poolId, msg.sender, alloc.assetIndex, alloc.subAmount);
    }

    // ------------------------------------------------------------ reclaim

    function reclaimExpired(uint256 poolId) external nonReentrant onlyCreator(poolId) {
        Pool storage p = pools[poolId];
        if (!p.exists) revert PoolNotFound();
        if (block.timestamp <= p.claimDeadline) revert NotExpired();
        if (p.state == PoolState.Expired) revert AlreadySettled();
        p.state = PoolState.Expired;
        // Reclaim this pool's ledger, never the contract-wide balance.
        // Includes unallocated NFTs, residual fungible dust and ERC-1155 inventory.
        for (uint256 i; i < p.assets.length; ++i) {
            Asset storage a = p.assets[i];
            uint256 remaining = a.amount;
            reserved[poolId][i] = 0;
            if (remaining == 0) continue;
            _transferAsset(poolId, i, p.creator, remaining);
            emit Reclaimed(poolId, p.creator, uint8(a.kind), a.tokenId, remaining);
        }
    }

    // ------------------------------------------------------------ internal

    /// @dev Transfers `share` of asset `assetIndex` to `to`.
    ///      `share` is the allocation's subAmount so one asset can be split
    ///      across multiple winners (OPEN mode) without underflowing the
    ///      committed ledger.
    function _transferAsset(uint256 poolId, uint256 assetIndex, address to, uint256 share) internal {
        Pool storage p = pools[poolId];
        if (to == address(0)) revert ZeroAddress();
        if (assetIndex >= p.assets.length) revert WrongAssetKind();
        Asset storage a = p.assets[assetIndex];
        if (share == 0 || share > a.amount || a.kind == AssetKind.ERC721 && share != 1) revert ZeroAmount();
        if (a.kind == AssetKind.ERC20) {
            if (share > a.amount) revert ZeroAmount();
            p.tokenCommitted[a.contractAddr] -= share;
            a.amount -= share;
            uint256 before = IERC20(a.contractAddr).balanceOf(to);
            IERC20(a.contractAddr).safeTransfer(to, share);
            if (IERC20(a.contractAddr).balanceOf(to) - before != share) revert TransferMismatch();
        } else if (a.kind == AssetKind.ERC721) {
            a.amount = 0;
            IERC721(a.contractAddr).safeTransferFrom(address(this), to, a.tokenId);
        } else if (a.kind == AssetKind.ERC1155) {
            if (share > a.amount) revert ZeroAmount();
            p.tokenCommitted[a.contractAddr] -= share;
            a.amount -= share;
            IERC1155(a.contractAddr).safeTransferFrom(address(this), to, a.tokenId, share, "");
        } else if (a.kind == AssetKind.ETH) {
            if (share > a.amount) revert ZeroAmount();
            p.tokenCommitted[address(0)] -= share;
            a.amount -= share;
            Address.sendValue(payable(to), share);
        }
    }

    function _active(uint256 poolId) internal view returns (Pool storage p) {
        p = pools[poolId];
        if (!p.exists) revert PoolNotFound();
        if (p.state != PoolState.Active) revert AlreadySettled();
        if (block.timestamp > p.claimDeadline) revert DeadlinePassed();
    }

    /// @notice Capability marker for fail-closed clients; requires a fresh deployment.
    function safetyVersion() external pure returns (uint256) { return 2; }

    function allocationInfo(uint256 poolId, uint256 allocIndex) external view returns (address, uint256, uint256, bool) {
        Pool storage p = pools[poolId];
        if (!p.exists) revert PoolNotFound();
        if (allocIndex >= p.allocationCount) revert BadAllocation();
        Allocation storage a = p.allocations[allocIndex];
        return (a.winner, a.assetIndex, a.subAmount, a.claimed);
    }

    // ------------------------------------------------------------ views

    function poolInfo(uint256 poolId)
        external
        view
        returns (
            address creator,
            bytes32 roomId,
            uint8 mode,
            uint64 deadline,
            uint8 state,
            uint256 allocCount,
            bytes32 merkleRoot,
            string memory message
        )
    {
        Pool storage p = pools[poolId];
        return (
            p.creator,
            p.roomId,
            uint8(p.mode),
            p.claimDeadline,
            uint8(p.state),
            p.allocationCount,
            p.merkleRoot,
            p.message
        );
    }

    function poolAssets(uint256 poolId)
        external
        view
        returns (uint8[] memory kinds, address[] memory contracts, uint256[] memory tokenIds, uint256[] memory amounts)
    {
        Pool storage p = pools[poolId];
        uint256 len = p.assets.length;
        kinds = new uint8[](len);
        contracts = new address[](len);
        tokenIds = new uint256[](len);
        amounts = new uint256[](len);
        for (uint256 i; i < len; ++i) {
            kinds[i] = uint8(p.assets[i].kind);
            contracts[i] = p.assets[i].contractAddr;
            tokenIds[i] = p.assets[i].tokenId;
            amounts[i] = p.assets[i].amount;
        }
    }

    function roomPoolIds(bytes32 roomId) external view returns (uint256[] memory) {
        return roomPools[roomId];
    }

    function getMessage(uint256 poolId) external view returns (string memory) {
        return pools[poolId].message;
    }

    function isClaimed(uint256 poolId, address claimant) external view returns (bool) {
        return pools[poolId].claimedBy[claimant];
    }

    // ------------------------------------------------------------ receivers

    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata) external view returns (bytes4) {
        if (msg.sender != receivingToken || operator != address(this) || from != receivingFrom || tokenId != receivingId) revert UnexpectedReceipt();
        return this.onERC721Received.selector;
    }

    function onERC1155Received(address operator, address from, uint256 tokenId, uint256 amount, bytes calldata) external view returns (bytes4) {
        if (msg.sender != receivingToken || operator != address(this) || from != receivingFrom || tokenId != receivingId || amount != receivingAmount) revert UnexpectedReceipt();
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert UnexpectedReceipt(); // No batch deposit ABI: unsolicited inventory must not be trapped.
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 || interfaceId == type(IERC721Receiver).interfaceId || interfaceId == type(IERC1155Receiver).interfaceId;
    }
}
