// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title OrbixRegistry — central address book for the Orbix ecosystem.
/// Everything (AMM, staking, bridge, NFT, marketplace) resolves through this,
/// so modules can be upgraded/re-pointed without touching each other.
contract OrbixRegistry {
    address public admin;
    mapping(bytes32 => address) public entries;

    event EntrySet(bytes32 indexed key, address indexed oldAddr, address newAddr);

    error NotAdmin();
    error ZeroAddress();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    function set(bytes32 key, address addr) external onlyAdmin {
        if (addr == address(0)) revert ZeroAddress();
        address old = entries[key];
        entries[key] = addr;
        emit EntrySet(key, old, addr);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        admin = newAdmin;
    }

    // Canonical keys
    function KEYS() external pure returns (bytes32[] memory) {
        bytes32[] memory k = new bytes32[](6);
        k[0] = keccak256("ORBIX_TOKEN");
        k[1] = keccak256("AMM_FACTORY");
        k[2] = keccak256("AMM_ROUTER");
        k[3] = keccak256("STAKING");
        k[4] = keccak256("BRIDGE");
        k[5] = keccak256("NFT_REGISTRY");
        return k;
    }
}
