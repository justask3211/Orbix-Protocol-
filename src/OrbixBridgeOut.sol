// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title OrbixBridgeOut (source side) — lock FREE/ORBIX tokens on chain A; relayer attests to mint on chain B.
contract OrbixBridgeOut is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable token;
    address public signer; // relayer attestor
    uint256 public totalLocked;
    mapping(bytes32 => bool) public claimed; // nonce replay protection

    event Locked(address indexed user, uint256 amount, uint64 nonce, bytes32 id);
    event SignerChanged(address oldSigner, address newSigner);

    error BadSignature();
    error NonceUsed();
    error ZeroAmount();

    constructor(address _token, address _signer) Ownable(msg.sender) {
        token = _token;
        signer = _signer;
    }

    function setSigner(address s) external onlyOwner {
        emit SignerChanged(signer, s);
        signer = s;
    }

    /// @notice Lock tokens to bridge OUT. Relayer watches Lock events and mints on destination.
    function lock(uint256 amount, uint64 nonce) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        bytes32 id = keccak256(abi.encodePacked(block.chainid, msg.sender, amount, nonce, address(this)));
        if (claimed[id]) revert NonceUsed();
        claimed[id] = true;
        totalLocked += amount;
        SafeERC20.safeTransferFrom(IERC20(token), msg.sender, address(this), amount);
        emit Locked(msg.sender, amount, nonce, id);
    }

    /// @notice Unlock tokens back when a bridge-IN happens on the other chain (relayer attests).
    function unlock(address to, uint256 amount, uint64 nonce, bytes calldata sig) external nonReentrant {
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            keccak256(abi.encodePacked(block.chainid, address(token), to, amount, nonce))
        ));
        if (_recover(digest, sig) != signer) revert BadSignature();
        bytes32 id = keccak256(abi.encodePacked("IN", block.chainid, to, amount, nonce));
        if (claimed[id]) revert NonceUsed();
        claimed[id] = true;
        totalLocked -= amount;
        SafeERC20.safeTransfer(IERC20(token), to, amount);
    }

    function _recover(bytes32 digest, bytes memory sig) internal pure returns (address) {
        require(sig.length == 65);
        bytes32 r; bytes32 s; uint8 v;
        assembly { r := mload(add(sig, 32)) s := mload(add(sig, 64)) v := byte(0, mload(add(sig, 96))) }
        if (v < 27) v += 27;
        return ecrecover(digest, v, r, s);
    }
}
