// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract FreeToken is ERC20("Free Test Token", "FREE") {
    constructor() {
        _mint(msg.sender, 1_000_000_000 ether);
    }
}
