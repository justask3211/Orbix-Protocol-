// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

/// @notice Test-only mintable ERC-20 used as the "TEST MOCK" platform/entry token.
/// @dev NOT a real platform token. Deployed to a local chain or the isolated testnet only.
contract MockERC20 is ERC20 {
    uint8 private immutable _dec;

    constructor(string memory n, string memory s, uint8 decimals_) ERC20(n, s) {
        _dec = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Fee-on-transfer ERC-20 used to prove the vault/escrow reject such assets.
contract MockFeeOnTransferERC20 is ERC20 {
    uint256 public feeBps = 100; // 1%

    constructor() ERC20("Fee Token", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = (value * feeBps) / 10_000;
            super._update(from, address(0xdead), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}

/// @notice Test-only ERC-721 reward asset.
contract MockERC721 is ERC721 {
    constructor() ERC721("Reward NFT", "RNFT") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }
}

/// @notice Test-only ERC-1155 reward asset.
contract MockERC1155 is ERC1155 {
    constructor() ERC1155("https://example.invalid/{id}") {}

    function mint(address to, uint256 id, uint256 amount) external {
        _mint(to, id, amount, "");
    }
}
