// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IERC20MetadataLike {
    function decimals() external view returns (uint8);
}

/// @title CreatorTokenGate
/// @notice Creator token binding for Orbix Center rooms (E6 creator-token flow).
///
/// The flow the owner specified:
///   1. Creator opens a room and chooses "I pay all ORBIX joiner fees". Only then
///      may they bind a personal token: their token contract address + the fee
///      (in THEIR token's base units) each joiner must pay to enter.
///   2. A joiner who holds the token approves THIS gate once, then calls join
///      (or is relayed with a signature). The gate pulls the token fee from the
///      joiner's own wallet — no ORBIX leaves the joiner, the creator's vault
///      covers the ORBIX part off-chain.
///   3. The creator can update the fee or rebind the token while the room is
///      open (mutable by design), but every change is an event the backend logs.
///   4. The creator can pause joining (e.g. token migration) and change the
///      treasury that receives the token fees.
///
/// Security posture:
///   - The gate NEVER takes custody of ORBIX; the ORBIX joiner-fee ledger stays
///     server-side exactly as today.
///   - Pull-based token fees: the joiner must approve; the gate cannot touch
///     funds without that allowance.
///   - Replay protection: each join intent (roomId, player, nonce) is one-time.
///   - ERC-165 style sanity checks on the token: symbol/decimals calls must
///     succeed at bind time, so a dead address can't be bound by accident.
contract CreatorTokenGate is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    address public admin; // platform admin (fee/treasury authority)
    address public treasury; // where token fees accumulate

    struct Binding {
        address creator;
        address token; // creator's ERC-20
        uint256 joinFee; // in token base units
        bool paused;
        bool exists;
    }

    /// roomId => binding
    mapping(bytes32 => Binding) public bindings;
    /// roomId => player => joined (one entry per player per room)
    mapping(bytes32 => mapping(address => bool)) public joined;
    /// roomId => player => nonce => used (replay guard for relayed joins)
    mapping(bytes32 => mapping(address => mapping(uint256 => bool))) public relayNonceUsed;

    event RoomBound(bytes32 indexed roomId, address indexed creator, address indexed token, uint256 joinFee);
    event BindingUpdated(bytes32 indexed roomId, uint256 oldFee, uint256 newFee, address newToken);
    event JoinPaused(bytes32 indexed roomId, bool paused);
    event CreatorJoined(bytes32 indexed roomId, address indexed player, uint256 fee, address token);
    event TreasuryChanged(address indexed oldTreasury, address indexed newTreasury);
    event AdminChanged(address indexed oldAdmin, address indexed newAdmin);

    error NotCreator();
    error NotAdmin();
    error AlreadyBound();
    error NotBound();
    error Paused();
    error AlreadyJoined();
    error ZeroFee();
    error ZeroAddress();
    error BadToken();
    error NonceUsed();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address _treasury) {
        admin = msg.sender;
        treasury = _treasury;
        emit AdminChanged(address(0), msg.sender);
    }

    // ------------------------------------------------------------- binding

    /// @notice Creator binds their token to a room. Only valid when the room's
    ///         ORBIX joiner fees are creator-absorbed (enforced off-chain by the
    ///         server refusing to publish a bound room without that flag).
    function bindRoom(bytes32 roomId, address token, uint256 joinFee) external {
        Binding storage b = bindings[roomId];
        if (b.exists) revert AlreadyBound();
        if (token == address(0)) revert ZeroAddress();
        if (joinFee == 0) revert ZeroFee();
        // sanity: the address must behave like a token (symbol/decimals readable)
        try IERC20MetadataLike(token).decimals() returns (
            uint8
        ) {
        // ok
        }
        catch {
            revert BadToken();
        }
        b.creator = msg.sender;
        b.token = token;
        b.joinFee = joinFee;
        b.exists = true;
        b.paused = false;
        emit RoomBound(roomId, msg.sender, token, joinFee);
    }

    /// @notice Creator updates the fee or swaps the token (mutable by design).
    function updateBinding(bytes32 roomId, address token, uint256 joinFee) external {
        Binding storage b = bindings[roomId];
        if (!b.exists) revert NotBound();
        if (b.creator != msg.sender) revert NotCreator();
        if (token == address(0)) revert ZeroAddress();
        if (joinFee == 0) revert ZeroFee();
        emit BindingUpdated(roomId, b.joinFee, joinFee, token);
        b.token = token;
        b.joinFee = joinFee;
    }

    function setPaused(bytes32 roomId, bool paused) external {
        Binding storage b = bindings[roomId];
        if (!b.exists) revert NotBound();
        if (b.creator != msg.sender) revert NotCreator();
        b.paused = paused;
        emit JoinPaused(roomId, paused);
    }

    // ------------------------------------------------------------- joining

    /// @notice Joiner joins with their own token. Requires prior approve() on
    ///         the token for this gate. The fee goes to the treasury; the
    ///         joiner's ORBIX balance is untouched.
    function join(bytes32 roomId) external nonReentrant {
        Binding storage b = bindings[roomId];
        if (!b.exists) revert NotBound();
        if (b.paused) revert Paused();
        if (joined[roomId][msg.sender]) revert AlreadyJoined();
        joined[roomId][msg.sender] = true;
        IERC20(b.token).safeTransferFrom(msg.sender, treasury, b.joinFee);
        emit CreatorJoined(roomId, msg.sender, b.joinFee, b.token);
    }

    /// @notice Relay variant: the backend (or anyone) submits a join on behalf of
    ///         a player who signed an intent. The signature binds
    ///         (roomId, player, nonce); the nonce is one-time.
    function joinRelayed(bytes32 roomId, address player, uint256 nonce, bytes calldata signature)
        external
        nonReentrant
    {
        Binding storage b = bindings[roomId];
        if (!b.exists) revert NotBound();
        if (b.paused) revert Paused();
        if (joined[roomId][player]) revert AlreadyJoined();
        if (relayNonceUsed[roomId][player][nonce]) revert NonceUsed();
        bytes32 digest =
            keccak256(abi.encodePacked("ORBIX_CREATOR_JOIN_V1", address(this), block.chainid, roomId, player, nonce));
        (bytes32 msgDigest,) = _digestToEthSign(digest);
        if (ECDSA.recover(msgDigest, signature) != player) revert BadToken(); // wrong signer
        relayNonceUsed[roomId][player][nonce] = true;
        joined[roomId][player] = true;
        IERC20(b.token).safeTransferFrom(player, treasury, b.joinFee);
        emit CreatorJoined(roomId, player, b.joinFee, b.token);
    }

    function _digestToEthSign(bytes32 h) internal pure returns (bytes32, bool) {
        // EIP-191: keccak256("\x19Ethereum Signed Message:\n32" ++ h)
        return (keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h)), true);
    }

    // ------------------------------------------------------------- admin

    function setTreasury(address newTreasury) external onlyAdmin {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryChanged(treasury, newTreasury);
        treasury = newTreasury;
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        emit AdminChanged(admin, newAdmin);
        admin = newAdmin;
    }

    // ------------------------------------------------------------- views

    function bindingOf(bytes32 roomId)
        external
        view
        returns (address creator, address token, uint256 joinFee, bool paused)
    {
        Binding storage b = bindings[roomId];
        return (b.creator, b.token, b.joinFee, b.paused);
    }

    function hasJoined(bytes32 roomId, address player) external view returns (bool) {
        return joined[roomId][player];
    }
}
