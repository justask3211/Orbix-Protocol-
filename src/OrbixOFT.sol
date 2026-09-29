// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OFT} from "@layerzerolabs/oft-evm/contracts/OFT.sol";
import {OFTAdapter} from "@layerzerolabs/oft-evm/contracts/OFTAdapter.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Omnichain Orbix: mint/burn OFT.
/// @dev mintable param is used by the OFT base
contract OrbixOFT is OFT {
    constructor(
        string memory _name,
        string memory _symbol,
        address _endpoint,
        address _owner,
        uint256 _initialMint
    ) OFT(_name, _symbol, _endpoint, _owner) Ownable(_owner) {
        _mint(_owner, _initialMint);
    }
}

/// @notice Lock/unlock adapter for an existing ERC20 (e.g. canonical FREE).
contract OrbixOFTAdapter is OFTAdapter {
    constructor(
        address _token,
        address _endpoint,
        address _owner
    ) OFTAdapter(_token, _endpoint, _owner) Ownable(_owner) {}
}
