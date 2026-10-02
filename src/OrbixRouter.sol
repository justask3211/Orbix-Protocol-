// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./OrbixFactory.sol";
import "./OrbixPair.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title OrbixRouter — user-facing entry: add/remove liquidity, swap ETH & tokens.
contract OrbixRouter {
    using SafeERC20 for IERC20;

    OrbixFactory public immutable factory;
    address public immutable WETH;

    event LiquidityAdded(address indexed pair, uint256 amount0, uint256 amount1, uint256 liquidity);
    event SwapExecuted(address indexed pair, uint256 amountIn, uint256 amountOut, address indexed to);

    error InsufficientAmount();
    error InsufficientOutput();
    error Expired();
    error EthTransferFailed();
    error InvalidPath();
    error ZeroAddress();
    error PairNotFound();

    constructor(address _factory, address _weth) {
        factory = OrbixFactory(_factory);
        WETH = _weth;
    }

    receive() external payable {}

    // ---- Liquidity ----

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        if (block.timestamp > deadline) revert Expired();
        if (to == address(0) || tokenA == address(0) || tokenB == address(0) || tokenA == tokenB) revert InvalidPath();
        if (amountADesired == 0 || amountBDesired == 0) revert InsufficientAmount();
        address pair = _pairFor(tokenA, tokenB);
        if (pair == address(0)) {
            pair = factory.createPair(tokenA, tokenB);
        }
        (uint256 rA, uint256 rB) = _reserves(pair, tokenA, tokenB);
        if (rA == 0 && rB == 0) {
            if (amountADesired < amountAMin || amountBDesired < amountBMin) revert InsufficientAmount();
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            uint256 optimalB = _quote(amountADesired, rA, rB);
            if (optimalB <= amountBDesired) {
                if (optimalB < amountBMin || amountADesired < amountAMin) revert InsufficientAmount();
                (amountA, amountB) = (amountADesired, optimalB);
            } else {
                uint256 optimalA = _quote(amountBDesired, rB, rA);
                if (optimalA < amountAMin) revert InsufficientAmount();
                (amountA, amountB) = (optimalA, amountBDesired);
            }
        }
        _pull(tokenA, msg.sender, amountA, address(pair));
        _pull(tokenB, msg.sender, amountB, address(pair));
        liquidity = OrbixPair(pair).mint(to);
        emit LiquidityAdded(pair, amountA, amountB, liquidity);
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB) {
        if (block.timestamp > deadline) revert Expired();
        if (to == address(0)) revert ZeroAddress();
        address pair = _pairFor(tokenA, tokenB);
        if (pair == address(0)) revert PairNotFound();
        SafeERC20.safeTransferFrom(IERC20(pair), msg.sender, pair, liquidity);
        (uint256 amount0, uint256 amount1) = OrbixPair(pair).burn(to);
        (amountA, amountB) = tokenA < tokenB ? (amount0, amount1) : (amount1, amount0);
        if (amountA < amountAMin || amountB < amountBMin) revert InsufficientAmount();
    }

    // ---- Swaps ----

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        if (block.timestamp > deadline) revert Expired();
        if (to == address(0)) revert ZeroAddress();
        amounts = getAmountsOut(amountIn, path);
        if (amounts[amounts.length - 1] < amountOutMin) revert InsufficientOutput();
        SafeERC20.safeTransferFrom(IERC20(path[0]), msg.sender, _pairFor(path[0], path[1]), amounts[0]);
        _swap(amounts, path, to);
        emit SwapExecuted(_pairFor(path[0], path[1]), amountIn, amounts[amounts.length - 1], to);
    }

    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory amounts)
    {
        if (block.timestamp > deadline) revert Expired();
        if (to == address(0) || path.length < 2 || path[0] != WETH) revert InvalidPath();
        amounts = getAmountsOut(msg.value, path);
        if (amounts[amounts.length - 1] < amountOutMin) revert InsufficientOutput();
        // ETH pairs in Orbix use WETH wrapper contract; for simplicity require WETH handled by caller-side wrapper
        // This router treats WETH as an ERC20 that must already hold the ETH — we forward ETH to WETH deposit
        _depositWETH(msg.value);
        SafeERC20.safeTransfer(IERC20(WETH), _pairFor(path[0], path[1]), amounts[0]);
        _swap(amounts, path, to);
        emit SwapExecuted(_pairFor(path[0], path[1]), msg.value, amounts[amounts.length - 1], to);
    }

    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        if (block.timestamp > deadline) revert Expired();
        if (to == address(0) || path.length < 2 || path[path.length - 1] != WETH) revert InvalidPath();
        amounts = getAmountsOut(amountIn, path);
        if (amounts[amounts.length - 1] < amountOutMin) revert InsufficientOutput();
        SafeERC20.safeTransferFrom(IERC20(path[0]), msg.sender, _pairFor(path[0], path[1]), amounts[0]);
        _swap(amounts, path, address(this));
        _withdrawWETH(amounts[amounts.length - 1]);
        (bool ok,) = to.call{value: amounts[amounts.length - 1]}("");
        if (!ok) revert EthTransferFailed();
        emit SwapExecuted(_pairFor(path[0], path[1]), amountIn, amounts[amounts.length - 1], to);
    }

    // ---- Quotes & library ----

    function getAmountsOut(uint256 amountIn, address[] memory path) public view returns (uint256[] memory amounts) {
        if (path.length < 2 || amountIn == 0 || path[0] == address(0) || path[1] == address(0) || path[0] == path[1]) {
            revert InvalidPath();
        }
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i = 0; i < path.length - 1; i++) {
            address pair = _pairFor(path[i], path[i + 1]);
            if (pair == address(0)) revert PairNotFound();
            (uint256 rIn, uint256 rOut) = _reserves(pair, path[i], path[i + 1]);
            amounts[i + 1] = getAmountOut(amounts[i], rIn, rOut);
        }
    }

    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public pure returns (uint256) {
        if (amountIn == 0 || reserveIn == 0 || reserveOut == 0) revert InsufficientAmount();
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * 1000 + amountInWithFee;
        return numerator / denominator;
    }

    function _quote(uint256 amountA, uint256 rA, uint256 rB) private pure returns (uint256) {
        if (amountA == 0 || rA == 0 || rB == 0) revert InsufficientAmount();
        return amountA * rB / rA;
    }

    function _pairFor(address tokenA, address tokenB) internal view returns (address) {
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return factory.getPair(t0, t1);
    }

    function _reserves(address pair, address tokenA, address tokenB) internal view returns (uint256 rA, uint256 rB) {
        if (pair == address(0)) revert PairNotFound();
        (uint112 r0, uint112 r1,) = OrbixPair(pair).getReserves();
        (address t0,) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        (rA, rB) = tokenA == t0 ? (r0, r1) : (r1, r0);
    }

    function _swap(uint256[] memory amounts, address[] memory path, address to) internal {
        for (uint256 i = 0; i < path.length - 1; i++) {
            (uint256 rIn, uint256 rOut) = _reserves(_pairFor(path[i], path[i + 1]), path[i], path[i + 1]);
            uint256 amountOut = amounts[i + 1];
            uint256 amount0Out = path[i] == _token0(path[i], path[i + 1]) ? 0 : amountOut;
            uint256 amount1Out = path[i] == _token0(path[i], path[i + 1]) ? amountOut : 0;
            address toAddr = i < path.length - 2 ? _pairFor(path[i + 1], path[i + 2]) : to;
            OrbixPair(_pairFor(path[i], path[i + 1])).swap(amount0Out, amount1Out, toAddr, "");
        }
    }

    function _token0(address a, address b) internal pure returns (address) {
        return a < b ? a : b;
    }

    function _pull(address token, address from, uint256 amount, address to) internal {
        SafeERC20.safeTransferFrom(IERC20(token), from, to, amount);
    }

    function _depositWETH(uint256 amount) internal {
        (bool ok,) = WETH.call{value: amount}(abi.encodeWithSignature("deposit()"));
        if (!ok) revert EthTransferFailed();
    }

    function _withdrawWETH(uint256 amount) internal {
        (bool ok,) = WETH.call(abi.encodeWithSignature("withdraw(uint256)", amount));
        if (!ok) revert EthTransferFailed();
    }
}
