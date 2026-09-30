// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Approval surface consulted by CenterEscrow before it accepts a round or asset.
interface ICenterRegistry {
    function isEscrow(address escrow) external view returns (bool);
    function isAsset(address asset) external view returns (bool);
    function isTemplate(bytes32 templateId) external view returns (bool);
    function feeRecipient() external view returns (address);
    function maxFeeBps() external view returns (uint16);
}

/// @notice Rotatable settlement-signing authority consulted by CenterEscrow.
interface ISettlementVerifier {
    function authorizedSigner(uint32 epoch) external view returns (address);
}
