// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title CenterVault
/// @notice One-time deposit of the platform token, then software-deducted per publication.
/// @dev Non-upgradeable, per-version, no admin sweep of user balances.
///
///      Model (see ORBIX CENTER BUILD MANUAL v4 section 4):
///        deposit()            -- one approve + one deposit; credits the creator's balance
///        deduct(intentId,..)  -- one call per published room; IDEMPOTENT per intentId
///        refundDeduction()    -- reverses a deduction that never became a live room
///        requestWithdraw()/executeWithdraw() -- bounded withdrawal of *uncommitted* balance
///
///      Safety properties enforced here:
///        * a deduction can never be taken twice for the same publication intent
///        * a deduction refund is capped at exactly what was deducted, once, to the creator
///        * a withdrawal can never touch a balance that has not yet been deducted for a room
///        * fee-on-transfer / rebasing tokens are rejected instead of mis-credited
contract CenterVault {
    using SafeERC20 for IERC20;

    IERC20 public immutable vaultToken;

    address public immutable coordinator;

    /// @dev Delay between requesting and executing a withdrawal.
    uint256 public constant WITHDRAW_DELAY = 2 days;

    mapping(address => uint256) public balanceOf;

    mapping(bytes32 => bool) public intentConsumed;
    mapping(bytes32 => address) public intentCreator;
    mapping(bytes32 => uint256) public intentAmount;
    mapping(bytes32 => bytes32) public intentRoom;
    mapping(bytes32 => bool) public intentRefunded;
    mapping(bytes32 => bool) public intentRefundable;

    mapping(address => uint256) public pendingWithdrawAmount;
    mapping(address => uint256) public pendingWithdrawAt;

    event Deposited(address indexed creator, uint256 amount);
    event Deducted(bytes32 indexed intentId, address indexed creator, uint256 amount, bytes32 indexed roomId);
    event DeductionRefunded(bytes32 indexed intentId, address indexed creator, uint256 amount);
    event WithdrawRequested(address indexed creator, uint256 amount, uint256 availableAt);
    event WithdrawCancelled(address indexed creator);
    event Withdrawn(address indexed creator, uint256 amount);

    error ZeroAmount();
    error InsufficientBalance();
    error IntentAlreadyConsumed();
    error IntentNotConsumed();
    error AlreadyRefunded();
    error NothingPending();
    error TooEarly();
    error NotCreator();
    error TransferMismatch();
    error NotCoordinator();
    error NotRefundable();
    error AlreadyRefundable();

    constructor(IERC20 token) {
        vaultToken = token;
        coordinator = msg.sender;
    }

    /// @notice Credit `amount` of the platform token to the caller. Requires a prior approve().
    function deposit(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        uint256 before = vaultToken.balanceOf(address(this));
        vaultToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = vaultToken.balanceOf(address(this)) - before;
        // Reject fee-on-transfer / rebasing tokens rather than mis-crediting the creator.
        if (received != amount) revert TransferMismatch();
        balanceOf[msg.sender] += received;
        emit Deposited(msg.sender, received);
    }

    /// @notice Deduct the price of one publication from the caller's balance.
    /// @dev Idempotent per `intentId`: a retried publish after a failure never charges twice.
    function deduct(bytes32 intentId, uint256 amount, bytes32 roomId) external {
        if (amount == 0) revert ZeroAmount();
        if (intentConsumed[intentId]) revert IntentAlreadyConsumed();
        if (balanceOf[msg.sender] < amount) revert InsufficientBalance();

        intentConsumed[intentId] = true;
        intentCreator[intentId] = msg.sender;
        intentAmount[intentId] = amount;
        intentRoom[intentId] = roomId;
        balanceOf[msg.sender] -= amount;

        emit Deducted(intentId, msg.sender, amount, roomId);
    }

    /// @notice Reverse a deduction for a room that was cancelled before it went live.
    /// @dev Callable only by the creator who was deducted, only once, and only for the
    ///      exact amount that was deducted.
    function refundDeduction(bytes32 intentId) external {
        if (!intentConsumed[intentId]) revert IntentNotConsumed();
        if (intentRefunded[intentId]) revert AlreadyRefunded();
        if (intentCreator[intentId] != msg.sender) revert NotCreator();
        if (!intentRefundable[intentId]) revert NotRefundable();

        intentRefunded[intentId] = true;
        uint256 amount = intentAmount[intentId];
        balanceOf[msg.sender] += amount;

        emit DeductionRefunded(intentId, msg.sender, amount);
    }

    function markRefundable(bytes32 intentId) external {
        if (msg.sender != coordinator) revert NotCoordinator();
        if (!intentConsumed[intentId]) revert IntentNotConsumed();
        if (intentRefunded[intentId]) revert AlreadyRefunded();
        if (intentRefundable[intentId]) revert AlreadyRefundable();
        intentRefundable[intentId] = true;
    }

    /// @notice Start the bounded withdrawal of uncommitted balance.
    function requestWithdraw(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (amount > balanceOf[msg.sender]) revert InsufficientBalance();
        pendingWithdrawAmount[msg.sender] = amount;
        pendingWithdrawAt[msg.sender] = block.timestamp + WITHDRAW_DELAY;
        emit WithdrawRequested(msg.sender, amount, pendingWithdrawAt[msg.sender]);
    }

    function cancelWithdraw() external {
        if (pendingWithdrawAmount[msg.sender] == 0) revert NothingPending();
        pendingWithdrawAmount[msg.sender] = 0;
        pendingWithdrawAt[msg.sender] = 0;
        emit WithdrawCancelled(msg.sender);
    }

    function executeWithdraw() external {
        uint256 amount = pendingWithdrawAmount[msg.sender];
        if (amount == 0) revert NothingPending();
        if (block.timestamp < pendingWithdrawAt[msg.sender]) revert TooEarly();
        if (amount > balanceOf[msg.sender]) revert InsufficientBalance();

        pendingWithdrawAmount[msg.sender] = 0;
        pendingWithdrawAt[msg.sender] = 0;
        balanceOf[msg.sender] -= amount;
        vaultToken.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }
}
