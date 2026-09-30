// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICenterRegistry} from "./ICenter.sol";

/// @title CenterRegistry
/// @notice Approves which escrow deployments, assets, templates and fee settings Center may use.
/// @dev Deliberately NOT upgradeable. A new version is deployed and escrows are pointed at it.
///      Updating the registry never rewrites the terms of an already-created round, because each
///      round stores its own snapshot of the values it needs.
contract CenterRegistry is ICenterRegistry {
    address public owner;
    address public feeRecipient;

    /// @dev Release one ships with rake disabled; owners may raise this only deliberately.
    uint16 public maxFeeBps;

    mapping(address => bool) public isEscrow;
    mapping(address => bool) public isAsset;
    mapping(bytes32 => bool) public isTemplate;

    event OwnershipTransferred(address indexed from, address indexed to);
    event EscrowSet(address indexed escrow, bool approved);
    event AssetSet(address indexed asset, bool approved);
    event TemplateSet(bytes32 indexed templateId, bool approved);
    event FeeRecipientSet(address indexed recipient);
    event MaxFeeBpsSet(uint16 bps);

    error NotOwner();
    error ZeroAddress();
    error FeeTooHigh();

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setEscrow(address escrow, bool approved) external onlyOwner {
        if (escrow == address(0)) revert ZeroAddress();
        isEscrow[escrow] = approved;
        emit EscrowSet(escrow, approved);
    }

    function setAsset(address asset, bool approved) external onlyOwner {
        if (asset == address(0)) revert ZeroAddress();
        isAsset[asset] = approved;
        emit AssetSet(asset, approved);
    }

    function setTemplate(bytes32 templateId, bool approved) external onlyOwner {
        isTemplate[templateId] = approved;
        emit TemplateSet(templateId, approved);
    }

    function setFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    function setMaxFeeBps(uint16 bps) external onlyOwner {
        if (bps > 500) revert FeeTooHigh(); // hard ceiling: 5%
        maxFeeBps = bps;
        emit MaxFeeBpsSet(bps);
    }

    function transferOwnership(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, to);
        owner = to;
    }
}
