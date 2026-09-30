// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICenterRegistry, ISettlementVerifier} from "./ICenter.sol";

/// @title CenterEscrow
/// @notice Prefunded, creator-sponsored reward escrow for Orbix Center rooms.
/// @dev Trust model (disclosed, not "trustless"): a named settlement authority signs the
///      result. The escrow constrains that authority to already-funded inventory, already
///      admitted entrants, a fixed deadline and a named epoch; it can never invent a
///      recipient or exceed what the creator deposited. Claiming is pull-based and the
///      destination is fixed to the entitlement winner, never msg.sender.
contract CenterEscrow is EIP712, ReentrancyGuard, IERC721Receiver, IERC1155Receiver {
    using SafeERC20 for IERC20;

    enum State {
        None,
        Registration,
        Cancelled,
        Settled,
        Funding
    }

    enum AssetKind {
        ERC20,
        ERC721,
        ERC1155
    }

    struct RoundSpec {
        bytes32 roundId;
        bytes32 configHash;
        bytes32 templateId;
        address entryAsset; // address(0) == free entry
        uint256 entryAmount;
        uint32 admissionCap;
        uint64 registrationStart;
        uint64 registrationEnd;
        uint64 playEnd;
        uint64 settlementDeadline;
        uint64 refundDeadline;
        uint64 claimDeadline;
        uint32 authorityEpoch;
        uint16 feeBps; // 0 in release one
        bytes32 payoutPolicyHash;
    }

    struct Round {
        bytes32 configHash;
        bytes32 templateId;
        address creator;
        address entryAsset;
        uint256 entryAmount;
        uint32 admissionCap;
        uint32 entrants;
        uint64 registrationStart;
        uint64 registrationEnd;
        uint64 playEnd;
        uint64 settlementDeadline;
        uint64 refundDeadline;
        uint64 claimDeadline;
        uint32 authorityEpoch;
        uint16 feeBps;
        bytes32 payoutPolicyHash;
        State state;
        bytes32 merkleRoot;
        bytes32 allocationsHash;
        bytes32 transcriptHash;
        uint256 entryTotal;
    }

    struct Entitlement {
        AssetKind assetKind;
        address assetContract;
        uint256 tokenId;
        uint256 amount;
        bytes32 claimId;
        bytes32 roundId;
        address winner;
        uint32 slotId;
        uint256 allocationNonce;
    }

    bytes32 private constant SETTLEMENT_TYPEHASH = keccak256(
        "Settlement(bytes32 roundId,bytes32 configHash,bytes32 merkleRoot,bytes32 allocationsHash,bytes32 transcriptHash,uint64 deadline,uint32 epoch)"
    );

    ICenterRegistry public immutable registry;
    ISettlementVerifier public immutable verifier;

    mapping(bytes32 => Round) internal _rounds;
    mapping(bytes32 => mapping(address => bool)) public admitted;
    mapping(bytes32 => bool) public claimed;
    mapping(bytes32 => mapping(bytes32 => uint256)) public reserved; // roundId => assetKey => units
    mapping(bytes32 => mapping(address => bool)) public entryRefunded;
    mapping(bytes32 => bytes32[]) internal _rewardKeys;
    mapping(bytes32 => mapping(bytes32 => uint256)) public declaredReward;

    event RoundCreated(bytes32 indexed roundId, address indexed creator, bytes32 indexed templateId, bytes32 configHash);
    event RegistrationOpened(bytes32 indexed roundId);
    event Funded(bytes32 indexed roundId, uint8 assetKind, address indexed asset, uint256 tokenId, uint256 amount);
    event Entered(bytes32 indexed roundId, address indexed player, uint256 paid);
    event RoundCancelled(bytes32 indexed roundId);
    event SettlementPublished(bytes32 indexed roundId, bytes32 merkleRoot, bytes32 allocationsHash, bytes32 transcriptHash);
    event Claimed(bytes32 indexed claimId, bytes32 indexed roundId, address indexed winner, uint8 assetKind, address asset, uint256 tokenId, uint256 amount);
    event EntryRefunded(bytes32 indexed roundId, address indexed player, uint256 amount);
    event UnusedRewardReclaimed(bytes32 indexed roundId, address indexed creator, uint8 assetKind, address asset, uint256 tokenId, uint256 amount);

    error NotCreator();
    error NotOpen();
    error RoundClosed();
    error RegistrationWindowClosed();
    error RoundFull();
    error AlreadyEntered();
    error NothingToRefund();
    error RefundNotAvailable();
    error AlreadyRefunded();
    error BadChronology();
    error BadTemplate();
    error BadAsset();
    error BadAmount();
    error FeeTooHigh();
    error BadSignature();
    error SignatureExpired();
    error WrongDeadline();
    error NotSettled();
    error ClaimWindowClosed();
    error ClaimWindowOpen();
    error NotAdmitted();
    error BadProof();
    error AlreadyClaimed();
    error InsufficientReserved();
    error TransferMismatch();
    error ZeroAddress();
    error RewardNotFunded();
    error PlayNotEnded();

    constructor(ICenterRegistry registry_, ISettlementVerifier verifier_)
        EIP712("OrbixCenterEscrow", "1")
    {
        if (address(registry_) == address(0) || address(verifier_) == address(0)) revert ZeroAddress();
        registry = registry_;
        verifier = verifier_;
    }

    // ---------------------------------------------------------------- create / fund

    function createRound(RoundSpec calldata spec) external returns (bytes32 roundId) {
        if (spec.roundId == bytes32(0)) revert BadAmount();
        if (_rounds[spec.roundId].state != State.None) revert AlreadyEntered();
        if (!registry.isTemplate(spec.templateId)) revert BadTemplate();
        if (spec.entryAsset != address(0) && !registry.isAsset(spec.entryAsset)) revert BadAsset();
        if (spec.feeBps > registry.maxFeeBps()) revert FeeTooHigh();
        if (
            spec.registrationStart == 0 || spec.registrationEnd <= spec.registrationStart
                || spec.playEnd < spec.registrationEnd || spec.settlementDeadline < spec.playEnd
                || spec.refundDeadline < spec.settlementDeadline || spec.claimDeadline <= spec.refundDeadline
        ) revert BadChronology();

        Round storage r = _rounds[spec.roundId];
        r.configHash = spec.configHash;
        r.templateId = spec.templateId;
        r.creator = msg.sender;
        r.entryAsset = spec.entryAsset;
        r.entryAmount = spec.entryAmount;
        r.admissionCap = spec.admissionCap;
        r.registrationStart = spec.registrationStart;
        r.registrationEnd = spec.registrationEnd;
        r.playEnd = spec.playEnd;
        r.settlementDeadline = spec.settlementDeadline;
        r.refundDeadline = spec.refundDeadline;
        r.claimDeadline = spec.claimDeadline;
        r.authorityEpoch = spec.authorityEpoch;
        r.feeBps = spec.feeBps;
        r.payoutPolicyHash = spec.payoutPolicyHash;
        r.state = State.Funding;
        emit RoundCreated(spec.roundId, msg.sender, spec.templateId, spec.configHash);
        return spec.roundId;
    }

    /// @notice Commit exact reward inventory before accepting any entrants.
    function declareReward(bytes32 roundId, bytes32 key, uint256 amount) external {
        Round storage r = _requireCreator(roundId);
        if (r.state != State.Funding) revert RoundClosed();
        if (amount == 0 || key == bytes32(0)) revert BadAmount();
        if (declaredReward[roundId][key] != 0) revert AlreadyEntered();
        declaredReward[roundId][key] = amount;
        _rewardKeys[roundId].push(key);
    }

    function fundERC20(bytes32 roundId, address token, uint256 amount) external {
        Round storage r = _requireCreator(roundId);
        if (r.state == State.Settled) revert RoundClosed();
        if (!registry.isAsset(token) || amount == 0) revert BadAsset();
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        if (IERC20(token).balanceOf(address(this)) - before != amount) revert TransferMismatch();
        _addReserved(roundId, AssetKind.ERC20, token, 0, amount);
        emit Funded(roundId, uint8(AssetKind.ERC20), token, 0, amount);
    }

    function fundERC721(bytes32 roundId, address token, uint256 tokenId) external {
        Round storage r = _requireCreator(roundId);
        if (r.state == State.Settled) revert RoundClosed();
        if (!registry.isAsset(token)) revert BadAsset();
        if (reserved[roundId][_assetKey(AssetKind.ERC721, token, tokenId)] != 0) revert AlreadyClaimed();
        IERC721(token).safeTransferFrom(msg.sender, address(this), tokenId);
        _addReserved(roundId, AssetKind.ERC721, token, tokenId, 1);
        emit Funded(roundId, uint8(AssetKind.ERC721), token, tokenId, 1);
    }

    function fundERC1155(bytes32 roundId, address token, uint256 tokenId, uint256 amount) external {
        Round storage r = _requireCreator(roundId);
        if (r.state == State.Settled) revert RoundClosed();
        if (!registry.isAsset(token) || amount == 0) revert BadAsset();
        IERC1155(token).safeTransferFrom(msg.sender, address(this), tokenId, amount, "");
        _addReserved(roundId, AssetKind.ERC1155, token, tokenId, amount);
        emit Funded(roundId, uint8(AssetKind.ERC1155), token, tokenId, amount);
    }

    // ---------------------------------------------------------------- registration / entry

    function openRegistration(bytes32 roundId) external {
        Round storage r = _rounds[roundId];
        if (r.creator != msg.sender) revert NotCreator();
        if (r.state != State.Funding) revert NotOpen();
        if (block.timestamp < r.registrationStart) revert RegistrationWindowClosed();
        bytes32[] storage keys = _rewardKeys[roundId];
        if (keys.length == 0) revert RewardNotFunded();
        for (uint256 i; i < keys.length; ++i) {
            if (reserved[roundId][keys[i]] != declaredReward[roundId][keys[i]]) revert RewardNotFunded();
        }
        r.state = State.Registration;
        emit RegistrationOpened(roundId);
    }

    function enter(bytes32 roundId) external nonReentrant {
        Round storage r = _rounds[roundId];
        if (r.state != State.Registration) revert NotOpen();
        uint256 now_ = block.timestamp;
        if (now_ < r.registrationStart || now_ > r.registrationEnd) revert RegistrationWindowClosed();
        // Report the caller's own state before the room's, so a repeat entry is not
        // misreported as "full".
        if (admitted[roundId][msg.sender]) revert AlreadyEntered();
        if (r.entrants >= r.admissionCap) revert RoundFull();

        admitted[roundId][msg.sender] = true;
        r.entrants += 1;

        uint256 paid = 0;
        if (r.entryAsset != address(0) && r.entryAmount != 0) {
            uint256 before = IERC20(r.entryAsset).balanceOf(address(this));
            IERC20(r.entryAsset).safeTransferFrom(msg.sender, address(this), r.entryAmount);
            paid = IERC20(r.entryAsset).balanceOf(address(this)) - before;
            if (paid != r.entryAmount) revert TransferMismatch();
            r.entryTotal += paid;
        }
        emit Entered(roundId, msg.sender, paid);
    }

    function cancelRound(bytes32 roundId) external {
        Round storage r = _rounds[roundId];
        if (r.creator != msg.sender) revert NotCreator();
        if (r.state != State.Registration) revert RoundClosed();
        r.state = State.Cancelled;
        emit RoundCancelled(roundId);
    }

    // ---------------------------------------------------------------- settlement

    function publishSettlement(
        bytes32 roundId,
        bytes32 merkleRoot,
        bytes32 allocationsHash,
        bytes32 transcriptHash,
        uint64 deadline,
        bytes calldata signature
    ) external {
        Round storage r = _rounds[roundId];
        if (r.state != State.Registration) revert RoundClosed();
        if (block.timestamp < r.playEnd) revert PlayNotEnded();
        if (deadline != r.settlementDeadline) revert WrongDeadline();
        if (block.timestamp > deadline) revert SignatureExpired();

        address signer = verifier.authorizedSigner(r.authorityEpoch);
        if (signer == address(0)) revert BadSignature();

        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SETTLEMENT_TYPEHASH, roundId, r.configHash, merkleRoot, allocationsHash, transcriptHash, deadline, r.authorityEpoch
                )
            )
        );
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || recovered != signer) revert BadSignature();

        r.merkleRoot = merkleRoot;
        r.allocationsHash = allocationsHash;
        r.transcriptHash = transcriptHash;
        r.state = State.Settled;

        // Rake is disabled in release one (feeBps == 0). If ever enabled it is taken here,
        // never retrospectively, and only up to the registry ceiling.
        if (r.feeBps > 0 && r.entryTotal > 0) {
            uint256 fee = (r.entryTotal * r.feeBps) / 10_000;
            if (fee > 0) {
                IERC20(r.entryAsset).safeTransfer(registry.feeRecipient(), fee);
            }
        }

        emit SettlementPublished(roundId, merkleRoot, allocationsHash, transcriptHash);
    }

    function claim(Entitlement calldata e, bytes32[] calldata proof) external nonReentrant {
        Round storage r = _rounds[e.roundId];
        if (r.state != State.Settled) revert NotSettled();
        if (block.timestamp > r.claimDeadline) revert ClaimWindowClosed();
        if (!admitted[e.roundId][e.winner]) revert NotAdmitted();
        if (claimed[e.claimId]) revert AlreadyClaimed();
        if (e.assetContract == address(0) || !registry.isAsset(e.assetContract)) revert BadAsset();
        if (e.amount == 0) revert BadAmount();

        bytes32 leaf = _leaf(e);
        if (!MerkleProof.verify(proof, r.merkleRoot, leaf)) revert BadProof();

        claimed[e.claimId] = true;

        bytes32 key = _assetKey(e.assetKind, e.assetContract, e.tokenId);
        uint256 available = reserved[e.roundId][key];
        if (available < e.amount) revert InsufficientReserved();
        reserved[e.roundId][key] = available - e.amount;

        _payout(e);

        emit Claimed(e.claimId, e.roundId, e.winner, uint8(e.assetKind), e.assetContract, e.tokenId, e.amount);
    }

    // ---------------------------------------------------------------- refunds / reclaim

    /// @notice Pull-refund a player entry when the round was cancelled or never settled in time.
    function refundEntry(bytes32 roundId) external nonReentrant {
        Round storage r = _rounds[roundId];
        if (entryRefunded[roundId][msg.sender]) revert AlreadyRefunded();
        if (!admitted[roundId][msg.sender]) revert NotAdmitted();
        if (r.entryAsset == address(0) || r.entryAmount == 0) revert NothingToRefund();

        bool cancelled = r.state == State.Cancelled;
        bool missed = r.state != State.Settled && block.timestamp > r.refundDeadline;
        if (!cancelled && !missed) revert RefundNotAvailable();

        entryRefunded[roundId][msg.sender] = true;
        IERC20(r.entryAsset).safeTransfer(msg.sender, r.entryAmount);
        emit EntryRefunded(roundId, msg.sender, r.entryAmount);
    }

    /// @notice After the claim window, the creator reclaims reward inventory nobody claimed.
    function reclaimUnusedReward(bytes32 roundId, AssetKind kind, address asset, uint256 tokenId) external nonReentrant {
        Round storage r = _rounds[roundId];
        if (r.creator != msg.sender) revert NotCreator();
        if (block.timestamp <= r.claimDeadline) revert ClaimWindowOpen();

        bytes32 key = _assetKey(kind, asset, tokenId);
        uint256 amount = reserved[roundId][key];
        if (amount == 0) revert InsufficientReserved();
        reserved[roundId][key] = 0;

        if (kind == AssetKind.ERC20) {
            IERC20(asset).safeTransfer(msg.sender, amount);
        } else if (kind == AssetKind.ERC721) {
            IERC721(asset).safeTransferFrom(address(this), msg.sender, tokenId);
        } else {
            IERC1155(asset).safeTransferFrom(address(this), msg.sender, tokenId, amount, "");
        }

        emit UnusedRewardReclaimed(roundId, msg.sender, uint8(kind), asset, tokenId, amount);
    }

    // ---------------------------------------------------------------- views

    function roundOf(bytes32 roundId) external view returns (Round memory) {
        return _rounds[roundId];
    }

    function assetKey(AssetKind kind, address asset, uint256 tokenId) external pure returns (bytes32) {
        return _assetKey(kind, asset, tokenId);
    }

    function entitlementLeaf(Entitlement calldata e) external view returns (bytes32) {
        return _leaf(e);
    }

    function settlementDigest(
        bytes32 roundId,
        bytes32 merkleRoot,
        bytes32 allocationsHash,
        bytes32 transcriptHash,
        uint64 deadline
    ) external view returns (bytes32) {
        Round storage r = _rounds[roundId];
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SETTLEMENT_TYPEHASH, roundId, r.configHash, merkleRoot, allocationsHash, transcriptHash, deadline, r.authorityEpoch
                )
            )
        );
    }

    // ---------------------------------------------------------------- internals

    function _requireCreator(bytes32 roundId) private view returns (Round storage r) {
        r = _rounds[roundId];
        if (r.creator != msg.sender) revert NotCreator();
    }

    function _assetKey(AssetKind kind, address asset, uint256 tokenId) private pure returns (bytes32) {
        return keccak256(abi.encode(kind, asset, tokenId));
    }

    function _addReserved(bytes32 roundId, AssetKind kind, address asset, uint256 tokenId, uint256 amount) private {
        reserved[roundId][_assetKey(kind, asset, tokenId)] += amount;
    }

    function _leaf(Entitlement calldata e) private view returns (bytes32) {
        bytes32 expectedClaimId =
            keccak256(abi.encode(block.chainid, address(this), e.roundId, e.winner, e.slotId, e.allocationNonce));
        if (expectedClaimId != e.claimId) revert BadProof();
        // OpenZeppelin standard Merkle leaf: hash the ABI encoding, then hash that
        // 32-byte result once more. The off-chain tree builder must mirror this exactly.
        bytes32 inner = keccak256(
            abi.encode(
                e.claimId,
                block.chainid,
                address(this),
                e.roundId,
                e.winner,
                e.assetKind,
                e.assetContract,
                e.tokenId,
                e.amount
            )
        );
        return keccak256(bytes.concat(inner));
    }

    function _payout(Entitlement calldata e) private {
        if (e.assetKind == AssetKind.ERC20) {
            IERC20(e.assetContract).safeTransfer(e.winner, e.amount);
        } else if (e.assetKind == AssetKind.ERC721) {
            IERC721(e.assetContract).safeTransferFrom(address(this), e.winner, e.tokenId);
        } else {
            IERC1155(e.assetContract).safeTransferFrom(address(this), e.winner, e.tokenId, e.amount, "");
        }
    }

    // ---------------------------------------------------------------- receivers

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC721Receiver).interfaceId || interfaceId == type(IERC1155Receiver).interfaceId
            || interfaceId == type(IERC165).interfaceId;
    }
}
