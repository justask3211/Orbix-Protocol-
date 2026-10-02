// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title OrbixPair — LP token + constant-product pair (Uniswap V2 style, hardened).
contract OrbixPair is ERC20, ERC20Permit, Ownable {
    address public immutable token0;
    address public immutable token1;
    address public factory;

    uint112 private reserve0;
    uint112 private reserve1;
    uint32 private blockTimestampLast;

    uint256 public price0CumulativeLast;
    uint256 public price1CumulativeLast;
    uint256 public kLast;

    uint256 public constant FEE_NUMERATOR = 997;
    uint256 public constant FEE_DENOMINATOR = 1000;
    uint256 private constant MINIMUM_LIQUIDITY = 1000;

    error Locked();
    error InsufficientOutput();
    error IdenticalAddresses();
    error ZeroAddress();
    error Overflow();
    error NotFactory();
    error InsufficientLiquidityMinted();
    error InsufficientLiquidityBurned();

    uint256 private unlocked = 1;
    modifier lock() {
        if (unlocked != 1) revert Locked();
        unlocked = 0;
        _;
        unlocked = 1;
    }

    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );
    event Sync(uint112 reserve0, uint112 reserve1);

    constructor(address _token0, address _token1)
        ERC20("Orbix LP Token", "ORBIX-LP")
        ERC20Permit("Orbix LP Token")
        Ownable(msg.sender)
    {
        if (_token0 == address(0) || _token1 == address(0)) revert ZeroAddress();
        if (_token0 == _token1) revert IdenticalAddresses();
        (token0, token1) = _token0 < _token1 ? (_token0, _token1) : (_token1, _token0);
        factory = msg.sender;
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, blockTimestampLast);
    }

    function _update(uint256 bal0, uint256 bal1, uint32 blockTimestamp) private {
        if (bal0 > type(uint112).max || bal1 > type(uint112).max) revert Overflow();
        uint32 elapsed;
        unchecked {
            elapsed = blockTimestamp - blockTimestampLast;
        }
        // UQ112x112 price accumulators over the PRIOR reserves (Uniswap V2 semantics).
        // price0 = reserve1/reserve0, price1 = reserve0/reserve1; accumulate BEFORE overwriting reserves.
        if (elapsed > 0 && reserve0 != 0 && reserve1 != 0) {
            unchecked {
                price0CumulativeLast += (uint256(reserve1) << 112) / reserve0 * elapsed;
                price1CumulativeLast += (uint256(reserve0) << 112) / reserve1 * elapsed;
            }
        }
        reserve0 = uint112(bal0);
        reserve1 = uint112(bal1);
        blockTimestampLast = blockTimestamp;
        emit Sync(reserve0, reserve1);
    }

    function mint(address to) external lock returns (uint256 liquidity) {
        (uint112 r0, uint112 r1,) = (reserve0, reserve1, blockTimestampLast);
        uint256 bal0 = _balance(token0);
        uint256 bal1 = _balance(token1);
        uint256 amount0 = bal0 - r0;
        uint256 amount1 = bal1 - r1;

        uint256 _totalSupply = totalSupply();
        if (_totalSupply == 0) {
            if (amount0 == 0 || amount1 == 0 || amount0 * amount1 <= MINIMUM_LIQUIDITY * MINIMUM_LIQUIDITY) {
                revert InsufficientLiquidityMinted();
            }
            liquidity = _sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            _mint(address(1), MINIMUM_LIQUIDITY); // burn-slot at address(1), not zero (OZ forbids zero receiver)
        } else {
            liquidity = _min(amount0 * _totalSupply / r0, amount1 * _totalSupply / r1);
        }
        if (liquidity == 0) revert InsufficientLiquidityMinted();
        _mint(to, liquidity);
        _update(bal0, bal1, uint32(block.timestamp));
        emit Mint(msg.sender, amount0, amount1);
    }

    function burn(address to) external lock returns (uint256 amount0, uint256 amount1) {
        uint256 liquidity = balanceOf(address(this));
        (uint112 r0, uint112 r1,) = (reserve0, reserve1, blockTimestampLast);
        uint256 bal0 = _balance(token0);
        uint256 bal1 = _balance(token1);
        uint256 _totalSupply = totalSupply();
        amount0 = liquidity * bal0 / _totalSupply;
        amount1 = liquidity * bal1 / _totalSupply;
        if (amount0 == 0 || amount1 == 0) revert InsufficientLiquidityBurned();
        _burn(address(this), liquidity);
        _safeTransfer(token0, to, amount0);
        _safeTransfer(token1, to, amount1);
        _update(_balance(token0), _balance(token1), uint32(block.timestamp));
        emit Burn(msg.sender, amount0, amount1, to);
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external lock {
        if (amount0Out == 0 && amount1Out == 0) revert InsufficientOutput();
        (uint112 r0, uint112 r1,) = (reserve0, reserve1, blockTimestampLast);
        if (amount0Out >= r0 || amount1Out >= r1) revert InsufficientOutput();
        if (to == token0 || to == token1) revert InvalidRecipient();

        if (amount0Out > 0) _safeTransfer(token0, to, amount0Out);
        if (amount1Out > 0) _safeTransfer(token1, to, amount1Out);
        if (data.length > 0) IOrbixCallee(to).orbixCall(msg.sender, amount0Out, amount1Out, data);

        uint256 bal0 = _balance(token0);
        uint256 bal1 = _balance(token1);
        uint256 amount0In = bal0 > r0 - amount0Out ? bal0 - (r0 - amount0Out) : 0;
        uint256 amount1In = bal1 > r1 - amount1Out ? bal1 - (r1 - amount1Out) : 0;
        if (amount0In == 0 && amount1In == 0) revert InsufficientOutput();
        {
            uint256 bal0Adj = bal0 * 1000 - amount0In * 3;
            uint256 bal1Adj = bal1 * 1000 - amount1In * 3;
            if (bal0Adj * bal1Adj < uint256(r0) * r1 * 1000000) revert InsufficientOutput();
        }
        _update(bal0, bal1, uint32(block.timestamp));
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    function sync() external lock {
        _update(_balance(token0), _balance(token1), uint32(block.timestamp));
    }

    error InvalidRecipient();

    function _balance(address token) private view returns (uint256) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("balanceOf(address)", address(this)));
        require(ok && data.length >= 32);
        return abi.decode(data, (uint256));
    }

    function _safeTransfer(address token, address to, uint256 value) private {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSignature("transfer(address,uint256)", to, value));
        require(ok && (data.length == 0 || abi.decode(data, (bool))));
    }

    function _sqrt(uint256 y) private pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}

interface IOrbixCallee {
    function orbixCall(address sender, uint256 amount0Out, uint256 amount1Out, bytes calldata data) external;
}
