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

    address public admin; // platform admin
    address public treasury; // default destination when a room does not set one

    /// Robinhood testnet burn address: tokens sent here are provably gone.
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    /// Where a room's join fees go.
    enum Payee {
        CreatorWallet,
        CustomWallet,
        Burn
    }

    struct Binding {
        address creator; // who opened the room
        address token; // any ERC-20 chosen by the creator
        uint256 joinFee; // in the token's base units
        address payout; // resolved destination for CustomWallet / CreatorWallet
        Payee payee; // where the fee goes
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
    event PayoutChanged(bytes32 indexed roomId, address indexed oldPayout, address indexed newPayout, uint8 payee);
    event FeeBurned(bytes32 indexed roomId, address indexed player, address indexed token, uint256 amount);
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
    error BadPayee();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address _treasury) {
        admin = msg.sender;
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
        emit AdminChanged(address(0), msg.sender);
    }

    // ------------------------------------------------------------- binding

    /// @notice Creator binds their token to a room. Only valid when the room's
    ///         ORBIX joiner fees are creator-absorbed (enforced off-chain by the
    ///         server refusing to publish a bound room without that flag).
    /// @notice Creator binds ANY ERC-20 to a room and chooses where join fees go.
    ///         No ownership or graduation requirement on the token: only that it
    ///         answers decimals(). Payout is the creator's own wallet by default,
    ///         a custom address, or the burn address.
    function bindRoom(bytes32 roomId, address token, uint256 joinFee, Payee payee, address payout) external {
        Binding storage b = bindings[roomId];
        if (b.exists) revert AlreadyBound();
        if (token == address(0)) revert ZeroAddress();
        if (token.code.length == 0) revert BadToken();
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
        _setPayee(roomId, b, payee, payout);
        emit RoomBound(roomId, msg.sender, token, joinFee);
    }

    /// @dev Resolve and store the payout destination. CreatorWallet always maps to
    ///      the creator's own address; CustomWallet needs a non-zero address;
    ///      Burn maps to the burn address.
    function _setPayee(bytes32 roomId, Binding storage b, Payee payee, address payout) internal {
        address oldPayout = b.payout;
        if (payee == Payee.CreatorWallet) {
            b.payout = b.creator;
        } else if (payee == Payee.CustomWallet) {
            if (payout == address(0)) revert ZeroAddress();
            b.payout = payout;
        } else if (payee == Payee.Burn) {
            b.payout = BURN_ADDRESS;
        } else {
            revert BadPayee();
        }
        b.payee = payee;
        emit PayoutChanged(roomId, oldPayout, b.payout, uint8(payee));
    }

    /// @notice Creator updates the fee, token, or payout (mutable by design).
    function updateBinding(bytes32 roomId, address token, uint256 joinFee, Payee payee, address payout) external {
        Binding storage b = bindings[roomId];
        if (!b.exists) revert NotBound();
        if (b.creator != msg.sender) revert NotCreator();
        if (token == address(0)) revert ZeroAddress();
        if (token.code.length == 0) revert BadToken();
        if (joinFee == 0) revert ZeroFee();
        try IERC20MetadataLike(token).decimals() returns (uint8) {} catch { revert BadToken(); }
        emit BindingUpdated(roomId, b.joinFee, joinFee, token);
        b.token = token;
        b.joinFee = joinFee;
        _setPayee(roomId, b, payee, payout);
    }

    /// @notice Creator changes where fees go without touching the token or fee.
    function setPayout(bytes32 roomId, Payee payee, address payout) external {
        Binding storage b = bindings[roomId];
        if (!b.exists) revert NotBound();
        if (b.creator != msg.sender) revert NotCreator();
        _setPayee(roomId, b, payee, payout);
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
    ///         the token for this gate. The fee goes to the room's configured
    ///         payout (creator wallet, custom address, or burn); the joiner's
    ///         ORBIX balance is untouched.
    function join(bytes32 roomId) external nonReentrant {
        Binding storage b = bindings[roomId];
        if (!b.exists) revert NotBound();
        if (b.paused) revert Paused();
        if (joined[roomId][msg.sender]) revert AlreadyJoined();
        joined[roomId][msg.sender] = true;
        _pay(b.token, msg.sender, b.payout, b.joinFee);
        if (b.payee == Payee.Burn) {
            emit FeeBurned(roomId, msg.sender, b.token, b.joinFee);
        }
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
        bytes32 digest = joinDigest(roomId, player, nonce);
        (bytes32 msgDigest,) = _digestToEthSign(digest);
        if (ECDSA.recover(msgDigest, signature) != player) revert BadToken(); // wrong signer
        relayNonceUsed[roomId][player][nonce] = true;
        joined[roomId][player] = true;
        _pay(b.token, player, b.payout, b.joinFee);
        if (b.payee == Payee.Burn) {
            emit FeeBurned(roomId, player, b.token, b.joinFee);
        }
        emit CreatorJoined(roomId, player, b.joinFee, b.token);
    }

    /// @notice V2 signs the full current quote, so mutable bindings cannot increase a relayed charge.
    function joinDigest(bytes32 roomId, address player, uint256 nonce) public view returns (bytes32) {
        Binding storage b = bindings[roomId];
        if (!b.exists) revert NotBound();
        return keccak256(abi.encodePacked("ORBIX_CREATOR_JOIN_V2", address(this), block.chainid,
            roomId, player, nonce, b.token, b.joinFee, b.payout, uint8(b.payee)));
    }

    function _pay(address token, address player, address payout, uint256 amount) internal {
        // A self-payee must not turn an entry fee into a free join.
        if (player == payout) revert BadPayee();
        uint256 before = IERC20(token).balanceOf(payout);
        IERC20(token).safeTransferFrom(player, payout, amount);
        if (IERC20(token).balanceOf(payout) - before != amount) revert BadToken();
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
        returns (address creator, address token, uint256 joinFee, address payout, uint8 payee, bool paused)
    {
        Binding storage b = bindings[roomId];
        return (b.creator, b.token, b.joinFee, b.payout, uint8(b.payee), b.paused);
    }

    function hasJoined(bytes32 roomId, address player) external view returns (bool) {
        return joined[roomId][player];
    }
}
