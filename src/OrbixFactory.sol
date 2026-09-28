// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./OrbixPair.sol";

/// @title OrbixFactory — permissionless pair creation with deterministic addresses (CREATE2).
contract OrbixFactory {
    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;
    bytes32 public constant PAIR_CODE_HASH = keccak256(type(OrbixPair).creationCode);

    event PairCreated(address indexed token0, address indexed token1, address pair, uint256 allPairsLength);

    error IdenticalAddresses();
    error ZeroAddress();
    error PairExists();

    constructor() {}

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        if (tokenA == tokenB) revert IdenticalAddresses();
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (t0 == address(0)) revert ZeroAddress();
        if (getPair[t0][t1] != address(0)) revert PairExists();

        bytes32 salt = keccak256(abi.encodePacked(t0, t1));
        OrbixPair newPair = new OrbixPair{salt: salt}(t0, t1);
        pair = address(newPair);

        getPair[t0][t1] = pair;
        getPair[t1][t0] = pair;
        allPairs.push(pair);
        emit PairCreated(t0, t1, pair, allPairs.length);
    }

    function pairCodeHash() external pure returns (bytes32) {
        return PAIR_CODE_HASH;
    }
}
