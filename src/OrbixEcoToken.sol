// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title OrbixEcoToken — the ecosystem token used for staking rewards & the 666 NFT burns.
/// Mint authority is fixed at deployment (staking contract); no infinite owner mint.
contract OrbixEcoToken is ERC20, Ownable {
    address public immutable minter;
    uint256 public immutable MAX_SUPPLY;

    event Minted(address indexed to, uint256 amount);

    error NotMinter();
    error MaxSupplyExceeded();

    constructor(address _minter, uint256 maxSupply) ERC20("Orbix Eco Token", "ORBIX-ECO") Ownable(msg.sender) {
        minter = _minter;
        MAX_SUPPLY = maxSupply;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert NotMinter();
        if (totalSupply() + amount > MAX_SUPPLY) revert MaxSupplyExceeded();
        _mint(to, amount);
        emit Minted(to, amount);
    }
}
