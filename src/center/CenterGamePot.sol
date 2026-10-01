// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title CenterGamePot
/// @notice Room entry-pot + creator-locked reward escrow for Orbix Center. v2.
///
///      v2 changes (E8/E9 hardening):
///        - settle() now verifies an authority signature over the full payout payload
///          (winners, amounts, reward winners, reward indices). The signature IS the
///          settlement authorization; any caller may relay a valid one.
///        - claimWinnings() is bound to (roomId, winner, amount, nonce) with
///          one-time nonce replay protection, plus the claim deadline.
///        - claimReward() is bound to (roomId, rewardIndex, winner, nonce) too.
///        - Refund returns exactly what the entrant paid, tracked per entrant.
///
///      Flow the owner asked for:
///        1. Creator opens a room with an entry fee (token + amount) and an optional
///           PAYOUT_WALLET — every entrant's fee lands in the pot.
///        2. Creator MAY lock a reward: ERC20 tokens or an ERC721 NFT, sent into this
///           contract and reserved for the room. The contract holds it until settlement.
///        3. Settlement is signed by the trusted settlement authority. Two payout modes:
///             AUTO  — winner + reward are paid the moment settlement is published.
///             MANUAL — winners claim pull-based with a signed entitlement.
///        4. Pot split at settlement: creator payout wallet gets its configured share,
///           the rest is divided among winning allocations.
///        5. Unclaimed rewards after the claim window: creator reclaims (manual mode)
///           or they were already paid (auto mode).
///        6. Treasury can sweep unreserved token dust only — never player entries,
///           never reserved rewards.
contract CenterGamePot is ReentrancyGuard, IERC721Receiver {
    using SafeERC20 for IERC20;

    enum Mode { Manual, Auto }

    struct Room {
        address creator;
        address payoutWallet;     // where the creator's share of the pot goes
        uint256 creatorShareBps;  // share of the pot routed to payoutWallet (0..10000)
        address entryToken;       // address(0) = free entry
        uint256 entryAmount;
        uint64 claimDeadline;
        Mode mode;
        bool settled;
        bool cancelled;
        uint256 pot;              // total entry fees held
        uint256 entrants;
        mapping(address => bool) entered;
        mapping(address => uint256) paidIn;    // actual amount each entrant paid in
        mapping(address => uint256) winAmount; // manual-mode ERC20 winnings per winner
    }

    struct LockedReward {
        address token;   // ERC20 or ERC721 contract
        uint256 tokenId; // for ERC721
        uint256 amount;  // ERC20 amount, or 1 for NFT
        bool isNft;
        bool paid;
    }

    address public immutable authority;      // settlement signer (backend signer key)
    address public treasury;                 // can sweep unreserved dust
    uint16 public feeBps;                    // protocol rake off the pot, capped
    uint16 public constant MAX_FEE_BPS = 1000; // 10% hard cap

    mapping(bytes32 => Room) private _rooms;
    mapping(bytes32 => LockedReward[]) private _rewards;
    mapping(bytes32 => mapping(address => bool)) public rewarded; // manual claim done
    mapping(bytes32 => mapping(uint256 => bool)) public claimNonceUsed; // roomId => nonce
    mapping(bytes32 => mapping(bytes32 => bool)) public settleDigestUsed; // replay guard

    /// @dev token => total value committed to pots and locked ERC20 rewards.
    ///      Pots subtract on refund/settle, rewards on pay/reclaim.
    mapping(address => uint256) public tokenCommitted;

    event RoomOpened(bytes32 indexed roomId, address indexed creator, address payoutWallet, uint256 creatorShareBps, address entryToken, uint256 entryAmount, uint8 mode);
    event Entered(bytes32 indexed roomId, address indexed player, uint256 amount);
    event RewardLocked(bytes32 indexed roomId, address indexed token, uint256 tokenId, uint256 amount, bool isNft);
    event Settled(bytes32 indexed roomId, address[] winners, uint256[] amounts, uint8 mode);
    event ManualClaim(bytes32 indexed roomId, address indexed winner, uint256 amount);
    event RewardPaid(bytes32 indexed roomId, address indexed winner, address token, uint256 tokenId, uint256 amount, bool isNft);
    event RoomCancelled(bytes32 indexed roomId);
    event EntryRefunded(bytes32 indexed roomId, address indexed player, uint256 amount);
    event RewardReclaimed(bytes32 indexed roomId, address indexed creator, address token, uint256 tokenId, uint256 amount, bool isNft);
    event TreasurySweep(address indexed token, uint256 amount);

    error NotCreator();
    error NotAuthority();
    error NotTreasury();
    error AlreadySettled();
    error NotOpen();
    error ZeroAmount();
    error BadShare();
    error BadSignature();
    error NotEntered();
    error NothingToClaim();
    error RefundNotAvailable();
    error AlreadyClaimedReward();
    error ClaimWindowClosed();
    error NonceReused();
    error FeeTooHigh();

    constructor(address _authority, address _treasury, uint16 _feeBps) {
        authority = _authority;
        treasury = _treasury;
        if (_feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = _feeBps;
    }

    // ------------------------------------------------------------- room lifecycle

    function openRoom(
        bytes32 roomId,
        address payoutWallet,
        uint256 creatorShareBps,
        address entryToken,
        uint256 entryAmount,
        Mode mode,
        uint64 claimDeadline
    ) external {
        Room storage r = _rooms[roomId];
        if (r.creator != address(0)) revert NotOpen();
        if (creatorShareBps > 10_000) revert BadShare();
        r.creator = msg.sender;
        r.payoutWallet = payoutWallet == address(0) ? msg.sender : payoutWallet;
        r.creatorShareBps = creatorShareBps;
        r.entryToken = entryToken;
        r.entryAmount = entryAmount;
        r.mode = mode;
        r.claimDeadline = claimDeadline;
        emit RoomOpened(roomId, msg.sender, r.payoutWallet, creatorShareBps, entryToken, entryAmount, uint8(mode));
    }

    function enter(bytes32 roomId) external nonReentrant {
        Room storage r = _rooms[roomId];
        if (r.creator == address(0) || r.settled || r.cancelled) revert NotOpen();
        if (r.entered[msg.sender]) revert NotEntered();
        r.entered[msg.sender] = true;
        r.entrants += 1;
        if (r.entryToken != address(0) && r.entryAmount != 0) {
            uint256 before = IERC20(r.entryToken).balanceOf(address(this));
            IERC20(r.entryToken).safeTransferFrom(msg.sender, address(this), r.entryAmount);
            uint256 paid = IERC20(r.entryToken).balanceOf(address(this)) - before;
            r.paidIn[msg.sender] = paid; // fee-on-transfer truth, not the sticker price
            r.pot += paid;
            tokenCommitted[r.entryToken] += paid;
            emit Entered(roomId, msg.sender, paid);
        } else {
            emit Entered(roomId, msg.sender, 0);
        }
    }

    // ------------------------------------------------------------- locked rewards

    function lockRewardERC20(bytes32 roomId, address token, uint256 amount) external {
        Room storage r = _rooms[roomId];
        if (r.creator != msg.sender) revert NotCreator();
        if (amount == 0) revert ZeroAmount();
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        if (IERC20(token).balanceOf(address(this)) - before != amount) revert ZeroAmount();
        tokenCommitted[token] += amount;
        _rewards[roomId].push(LockedReward(token, 0, amount, false, false));
        emit RewardLocked(roomId, token, 0, amount, false);
    }

    function lockRewardNFT(bytes32 roomId, address token, uint256 tokenId) external {
        Room storage r = _rooms[roomId];
        if (r.creator != msg.sender) revert NotCreator();
        IERC721(token).safeTransferFrom(msg.sender, address(this), tokenId);
        _rewards[roomId].push(LockedReward(token, tokenId, 1, true, false));
        emit RewardLocked(roomId, token, tokenId, 1, true);
    }

    // ------------------------------------------------------------- digests

    function settlementDigest(
        bytes32 roomId,
        address[] calldata winners,
        uint256[] calldata amounts,
        address[] calldata rewardWinners,
        uint256[] calldata rewardIndices
    ) public view returns (bytes32) {
        return keccak256(abi.encodePacked(
            "CENTER_POT_SETTLE_V1",
            address(this),
            block.chainid,
            roomId,
            keccak256(abi.encode(winners, amounts, rewardWinners, rewardIndices))
        ));
    }

    function claimWinningsDigest(bytes32 roomId, address winner, uint256 amount, uint256 nonce) public view returns (bytes32) {
        return keccak256(abi.encodePacked("CENTER_POT_CLAIM_V1", address(this), block.chainid, roomId, winner, amount, nonce));
    }

    function claimRewardDigest(bytes32 roomId, uint256 rewardIndex, address winner, uint256 nonce) public view returns (bytes32) {
        return keccak256(abi.encodePacked("CENTER_POT_REWARD_V1", address(this), block.chainid, roomId, rewardIndex, winner, nonce));
    }

    function _recover(bytes32 digest, bytes calldata signature) internal view returns (address) {
        if (signature.length == 0) revert NotAuthority(); // legacy: no relay sig supplied
        if (signature.length != 65) revert BadSignature();
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert BadSignature();
        return signer;
    }

    // ------------------------------------------------------------- settlement

    /// @notice Authority-signed settlement: pot split to winners (+ creator payout
    ///         wallet share), and in Auto mode rewards are pushed to rewardWinners.
    ///         winners/amounts must have equal length; amounts are ERC20 pot shares.
    ///         Anyone may relay a valid signature; the signature is the authorization.
    function settle(
        bytes32 roomId,
        address[] calldata winners,
        uint256[] calldata amounts,
        address[] calldata rewardWinners,
        uint256[] calldata rewardIndices,
        bytes calldata signature
    ) external nonReentrant {
        Room storage r = _rooms[roomId];
        if (r.settled || r.cancelled) revert AlreadySettled();
        if (winners.length != amounts.length) revert BadShare();
        bytes32 digest = settlementDigest(roomId, winners, amounts, rewardWinners, rewardIndices);
        if (settleDigestUsed[roomId][digest]) revert AlreadySettled();
        if (_recover(digest, signature) != authority) revert BadSignature();
        settleDigestUsed[roomId][digest] = true;
        if (rewardWinners.length != rewardIndices.length) revert BadShare();

        r.settled = true;

        // protocol rake, capped at construction
        uint256 pot = r.pot;
        address entryToken = r.entryToken;
        if (entryToken != address(0)) tokenCommitted[entryToken] -= pot;
        uint256 rake = (pot * feeBps) / 10_000;
        if (rake > 0 && entryToken != address(0)) {
            IERC20(entryToken).safeTransfer(treasury, rake);
            pot -= rake;
        }
        // creator's share of the pot to their payout wallet
        uint256 creatorCut = (pot * r.creatorShareBps) / 10_000;
        if (creatorCut > 0 && entryToken != address(0)) {
            IERC20(entryToken).safeTransfer(r.payoutWallet, creatorCut);
            pot -= creatorCut;
        }
        // remainder to winners; signed totals may never exceed the net pot
        uint256 total = 0;
        for (uint256 i; i < amounts.length; ++i) total += amounts[i];
        if (total > pot) revert BadShare();
        if (entryToken != address(0)) {
            if (r.mode == Mode.Auto) {
                // AUTO: push pot shares atomically at settlement.
                for (uint256 i; i < winners.length; ++i) {
                    if (amounts[i] > 0) IERC20(entryToken).safeTransfer(winners[i], amounts[i]);
                }
            }
            // MANUAL: winnings stay recorded as liabilities; winners pull via
            // signed claimWinnings before the claim deadline.
        }
        for (uint256 i; i < winners.length; ++i) r.winAmount[winners[i]] += amounts[i];

        // Auto mode: push locked rewards now
        if (r.mode == Mode.Auto) {
            for (uint256 j; j < rewardWinners.length; ++j) {
                _payReward(roomId, rewardWinners[j], rewardIndices[j]);
            }
        }

        emit Settled(roomId, winners, amounts, uint8(r.mode));
    }

    /// @notice Manual mode: a winner pulls their pot share with the authority's
    ///         signature over (roomId, winner, amount, nonce). One-time nonce.
    function claimWinnings(bytes32 roomId, address winner, uint256 amount, uint256 nonce, bytes calldata signature) external nonReentrant {
        Room storage r = _rooms[roomId];
        if (!r.settled) revert AlreadySettled();
        if (block.timestamp > r.claimDeadline) revert ClaimWindowClosed();
        if (claimNonceUsed[roomId][nonce]) revert NonceReused();
        bytes32 digest = claimWinningsDigest(roomId, winner, amount, nonce);
        if (_recover(digest, signature) != authority) revert NotAuthority();
        claimNonceUsed[roomId][nonce] = true;
        if (r.winAmount[winner] < amount) revert NothingToClaim();
        r.winAmount[winner] -= amount;
        if (r.entryToken != address(0)) IERC20(r.entryToken).safeTransfer(winner, amount);
        emit ManualClaim(roomId, winner, amount);
    }

    /// @notice Manual mode: pull a locked reward with the authority's signature
    ///         over (roomId, rewardIndex, winner, nonce). One-time nonce.
    function claimReward(bytes32 roomId, uint256 rewardIndex, address winner, uint256 nonce, bytes calldata signature) external nonReentrant {
        Room storage r = _rooms[roomId];
        if (!r.settled) revert AlreadySettled();
        if (block.timestamp > r.claimDeadline) revert ClaimWindowClosed();
        if (claimNonceUsed[roomId][nonce]) revert NonceReused();
        LockedReward storage lr = _rewards[roomId][rewardIndex];
        if (lr.paid) revert AlreadyClaimedReward();
        bytes32 digest = claimRewardDigest(roomId, rewardIndex, winner, nonce);
        if (_recover(digest, signature) != authority) revert NotAuthority();
        claimNonceUsed[roomId][nonce] = true;
        _payReward(roomId, winner, rewardIndex);
    }

    // ------------------------------------------------------------- cancel / reclaim / sweep

    function cancelRoom(bytes32 roomId) external {
        Room storage r = _rooms[roomId];
        if (r.creator != msg.sender) revert NotCreator();
        if (r.settled) revert AlreadySettled();
        r.cancelled = true;
        emit RoomCancelled(roomId);
    }

    /// @notice Refund returns exactly what the entrant paid (fee-on-transfer truth),
    ///         only on a cancelled room, exactly once.
    function refundEntry(bytes32 roomId) external nonReentrant {
        Room storage r = _rooms[roomId];
        if (!r.cancelled) revert RefundNotAvailable();
        if (!r.entered[msg.sender]) revert NotEntered();
        uint256 paid = r.paidIn[msg.sender];
        if (paid == 0) revert NothingToClaim();
        r.entered[msg.sender] = false;
        r.pot -= paid;
        tokenCommitted[r.entryToken] -= paid;
        IERC20(r.entryToken).safeTransfer(msg.sender, paid);
        emit EntryRefunded(roomId, msg.sender, paid);
    }

    function reclaimReward(bytes32 roomId, uint256 rewardIndex) external {
        Room storage r = _rooms[roomId];
        if (r.creator != msg.sender) revert NotCreator();
        if (!r.settled && !r.cancelled) revert NotOpen();
        if (r.settled && block.timestamp <= r.claimDeadline) revert ClaimWindowClosed();
        LockedReward storage lr = _rewards[roomId][rewardIndex];
        if (lr.paid) revert AlreadyClaimedReward();
        lr.paid = true;
        if (!lr.isNft) tokenCommitted[lr.token] -= lr.amount;
        if (lr.isNft) {
            IERC721(lr.token).safeTransferFrom(address(this), msg.sender, lr.tokenId);
        } else {
            IERC20(lr.token).safeTransfer(msg.sender, lr.amount);
        }
        emit RewardReclaimed(roomId, msg.sender, lr.token, lr.tokenId, lr.amount, lr.isNft);
    }

    /// @notice Treasury may sweep surplus of a token NO room has ever used for entry or
    ///         reward locking. Tracked per token in `tokenCommitted`, so pots and locked
    ///         rewards can never be swept.
    function sweepDust(address token, uint256 amount) external nonReentrant {
        if (msg.sender != treasury) revert NotTreasury();
        uint256 committed = tokenCommitted[token];
        if (IERC20(token).balanceOf(address(this)) - committed < amount) revert NothingToClaim();
        IERC20(token).safeTransfer(treasury, amount);
        emit TreasurySweep(token, amount);
    }

    // ------------------------------------------------------------------ internals

    function _payReward(bytes32 roomId, address winner, uint256 rewardIndex) internal {
        LockedReward storage lr = _rewards[roomId][rewardIndex];
        if (lr.paid) revert AlreadyClaimedReward();
        lr.paid = true;
        if (!lr.isNft) tokenCommitted[lr.token] -= lr.amount;
        if (lr.isNft) {
            IERC721(lr.token).safeTransferFrom(address(this), winner, lr.tokenId);
        } else {
            IERC20(lr.token).safeTransfer(winner, lr.amount);
        }
        emit RewardPaid(roomId, winner, lr.token, lr.tokenId, lr.amount, lr.isNft);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
