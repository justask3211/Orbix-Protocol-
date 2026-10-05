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
///   Private-key rewards: the creator generates a fresh EVM wallet, funds it
///   with the reward tokens, and registers the DERIVED ADDRESS as a
///   "key-reward" allocation. The private key is delivered off-chain (copy/
///   import). On-chain it looks like any other asset transfer — the winner
///   now controls that address and can sweep its contents.
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
        uint256 subAmount; // for ERC20: partial amount; for 721: tokenId
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

    modifier onlyCreator(uint256 poolId) {
        if (pools[poolId].creator != msg.sender) revert NotCreator();
        _;
    }

    constructor(address _authority) {
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
        Pool storage p = pools[poolId];
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
        IERC721(token).safeTransferFrom(msg.sender, address(this), tokenId);
        pools[poolId].assets.push(Asset(AssetKind.ERC721, token, tokenId, 1));
        pools[poolId].nftCommitted[tokenId] = true;
        emit AssetDeposited(poolId, uint8(AssetKind.ERC721), token, tokenId, 1);
    }

    function depositERC1155(uint256 poolId, address token, uint256 tokenId, uint256 amount, bytes calldata data)
        external
        nonReentrant
        onlyCreator(poolId)
    {
        if (amount == 0) revert ZeroAmount();
        IERC1155(token).safeTransferFrom(msg.sender, address(this), tokenId, amount, data);
        pools[poolId].assets.push(Asset(AssetKind.ERC1155, token, tokenId, amount));
        pools[poolId].tokenCommitted[token] += amount;
        emit AssetDeposited(poolId, uint8(AssetKind.ERC1155), token, tokenId, amount);
    }

    function depositETH(uint256 poolId) external payable nonReentrant onlyCreator(poolId) {
        if (msg.value == 0) revert ZeroAmount();
        pools[poolId].assets.push(Asset(AssetKind.ETH, address(0), 0, msg.value));
        pools[poolId].tokenCommitted[address(0)] += msg.value;
        emit AssetDeposited(poolId, uint8(AssetKind.ETH), address(0), 0, msg.value);
    }

    // ------------------------------------------------------------ allocations

    function setAllocation(uint256 poolId, address winner, uint256 assetIndex, uint256 subAmount)
        external
        onlyCreator(poolId)
    {
        Pool storage p = pools[poolId];
        if (p.state != PoolState.Active) revert AlreadySettled();
        if (assetIndex >= p.assets.length) revert WrongAssetKind();
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
        Pool storage p = pools[poolId];
        if (!p.exists) revert PoolNotFound();
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
        for (uint256 i; i < winners.length && i < assetIndices.length; ++i) {
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
        Pool storage p = pools[poolId];
        if (!p.exists) revert PoolNotFound();
        if (p.mode != ClaimMode.Code) revert WrongAssetKind();
        if (block.timestamp > p.claimDeadline) revert DeadlinePassed();
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
        Pool storage p = pools[poolId];
        if (!p.exists) revert PoolNotFound();
        if (p.mode != ClaimMode.Merkle) revert WrongAssetKind();
        if (block.timestamp > p.claimDeadline) revert DeadlinePassed();
        if (p.claimedBy[winner]) revert AlreadyClaimed();
        bytes32 leaf = keccak256(abi.encodePacked(winner, assetIndex, subAmount));
        if (!MerkleProof.verify(proof, p.merkleRoot, leaf)) revert BadMerkleProof();
        p.claimedBy[winner] = true;
        _transferAsset(poolId, assetIndex, winner, subAmount);
        emit RewardClaimed(poolId, winner, assetIndex, subAmount);
    }

    /// @notice OPEN mode: first N wallets to claim.
    function claimOpen(uint256 poolId, uint256 allocIndex) external nonReentrant {
        Pool storage p = pools[poolId];
        if (!p.exists) revert PoolNotFound();
        if (p.mode != ClaimMode.Open) revert WrongAssetKind();
        if (block.timestamp > p.claimDeadline) revert DeadlinePassed();
        if (p.openClaimed >= p.maxOpenClaims) revert OpenClaimsExhausted();
        Allocation storage alloc = p.allocations[allocIndex];
        if (alloc.claimed) revert AlreadyClaimed();
        if (alloc.winner != address(0)) revert NotWinner(); // OPEN allocations have zero winner
        alloc.winner = msg.sender;
        alloc.claimed = true;
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
        p.state = PoolState.Expired;
        for (uint256 i; i < p.assets.length; ++i) {
            Asset storage a = p.assets[i];
            if (a.kind == AssetKind.ERC20) {
                uint256 bal = IERC20(a.contractAddr).balanceOf(address(this));
                if (bal > 0) {
                    p.tokenCommitted[a.contractAddr] = 0;
                    IERC20(a.contractAddr).safeTransfer(p.creator, bal);
                    emit Reclaimed(poolId, p.creator, uint8(AssetKind.ERC20), 0, bal);
                }
            } else if (a.kind == AssetKind.ETH) {
                uint256 bal = address(this).balance;
                if (bal > 0) {
                    p.tokenCommitted[address(0)] = 0;
                    Address.sendValue(payable(p.creator), bal);
                    emit Reclaimed(poolId, p.creator, uint8(AssetKind.ETH), 0, bal);
                }
            }
            // NFTs handled separately (need tokenId list)
        }
        // reclaim all unclaimed NFTs
        for (uint256 i; i < p.allocationCount; ++i) {
            if (!p.allocations[i].claimed) {
                uint256 ai = p.allocations[i].assetIndex;
                Asset storage a = p.assets[ai];
                if (a.kind == AssetKind.ERC721) {
                    IERC721(a.contractAddr).safeTransferFrom(address(this), p.creator, a.tokenId);
                    emit Reclaimed(poolId, p.creator, uint8(AssetKind.ERC721), a.tokenId, 1);
                }
            }
        }
    }

    // ------------------------------------------------------------ internal

    /// @dev Transfers `share` of asset `assetIndex` to `to`.
    ///      `share` is the allocation's subAmount so one asset can be split
    ///      across multiple winners (OPEN mode) without underflowing the
    ///      committed ledger.
    function _transferAsset(uint256 poolId, uint256 assetIndex, address to, uint256 share) internal {
        Pool storage p = pools[poolId];
        Asset storage a = p.assets[assetIndex];
        if (a.kind == AssetKind.ERC20) {
            if (share > a.amount) revert ZeroAmount();
            p.tokenCommitted[a.contractAddr] -= share;
            a.amount -= share;
            IERC20(a.contractAddr).safeTransfer(to, share);
        } else if (a.kind == AssetKind.ERC721) {
            IERC721(a.contractAddr).safeTransferFrom(address(this), to, a.tokenId);
            a.amount = 0;
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

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC721Receiver).interfaceId || interfaceId == type(IERC1155Receiver).interfaceId;
    }
}
