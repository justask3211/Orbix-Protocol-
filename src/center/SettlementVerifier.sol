// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISettlementVerifier} from "./ICenter.sol";

/// @title SettlementVerifier
/// @notice Rotatable result-signing authority for Center escrows.
/// @dev The signer is a DISCLOSED trusted component on testnet, not a trustless oracle.
///      Epochs allow the escrow to bind a settlement to a specific key generation, so a
///      rotated key cannot replay an old settlement. Rotating sets a NEW epoch; the old
///      epoch's signer is cleared explicitly by `revokeEpoch`.
contract SettlementVerifier is ISettlementVerifier {
    address public owner;
    mapping(uint32 => address) public signerOfEpoch;
    uint32 public latestEpoch;

    event EpochSignerSet(uint32 indexed epoch, address signer);
    event EpochRevoked(uint32 indexed epoch, address previousSigner);
    event OwnershipTransferred(address indexed from, address indexed to);

    error NotOwner();
    error ZeroAddress();

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setEpochSigner(uint32 epoch, address signer) external onlyOwner {
        if (signer == address(0)) revert ZeroAddress();
        signerOfEpoch[epoch] = signer;
        if (epoch > latestEpoch) latestEpoch = epoch;
        emit EpochSignerSet(epoch, signer);
    }

    function revokeEpoch(uint32 epoch) external onlyOwner {
        address prev = signerOfEpoch[epoch];
        signerOfEpoch[epoch] = address(0);
        emit EpochRevoked(epoch, prev);
    }

    function authorizedSigner(uint32 epoch) external view returns (address) {
        return signerOfEpoch[epoch];
    }

    function transferOwnership(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, to);
        owner = to;
    }
}
