// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title OrbixMarket — NFT marketplace priced in ORBIX-ECO, with holder fee discounts.
contract OrbixMarket is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable paymentToken;
    address public orbix666; // for holder discounts
    uint256 public feeBps = 250; // 2.5% default; holders of Orbix666 get 25% off via feeDiscountBps

    struct Listing {
        address seller;
        address nft;
        uint256 tokenId;
        uint256 price;
        bool active;
    }

    uint256 public nextListingId = 1;
    mapping(uint256 => Listing) public listings;

    event Listed(uint256 indexed id, address indexed seller, address indexed nft, uint256 tokenId, uint256 price);
    event Cancelled(uint256 indexed id);
    event Sold(uint256 indexed id, address indexed buyer, uint256 price, uint256 fee);

    error NotOwner();
    error NotActive();
    error WrongPrice();

    constructor(address _paymentToken) Ownable(msg.sender) {
        paymentToken = IERC20(_paymentToken);
    }

    function setOrbix666(address a) external onlyOwner {
        orbix666 = a;
    }

    function setFeeBps(uint256 b) external onlyOwner {
        feeBps = b;
    }

    function list(address nft, uint256 tokenId, uint256 price) external returns (uint256 id) {
        if (IERC721(nft).ownerOf(tokenId) != msg.sender) revert NotOwner();
        IERC721(nft).transferFrom(msg.sender, address(this), tokenId);
        id = nextListingId++;
        listings[id] = Listing({seller: msg.sender, nft: nft, tokenId: tokenId, price: price, active: true});
        emit Listed(id, msg.sender, nft, tokenId, price);
    }

    function cancel(uint256 id) external {
        Listing storage l = listings[id];
        if (!l.active) revert NotActive();
        if (l.seller != msg.sender) revert NotOwner();
        l.active = false;
        IERC721(l.nft).transferFrom(address(this), l.seller, l.tokenId);
        emit Cancelled(id);
    }

    function buy(uint256 id) external nonReentrant {
        Listing storage l = listings[id];
        if (!l.active) revert NotActive();
        l.active = false;

        uint256 discount = 0;
        if (orbix666 != address(0)) {
            (bool ok, bytes memory data) =
                orbix666.staticcall(abi.encodeWithSignature("feeDiscountBps(address)", msg.sender));
            if (ok && data.length >= 32) discount = abi.decode(data, (uint256));
        }
        uint256 effectiveFee = feeBps * (10_000 - discount) / 10_000;
        uint256 fee = l.price * effectiveFee / 10_000;
        uint256 proceeds = l.price - fee;

        SafeERC20.safeTransferFrom(paymentToken, msg.sender, address(this), l.price);
        SafeERC20.safeTransfer(paymentToken, l.seller, proceeds);
        IERC721(l.nft).transferFrom(address(this), msg.sender, l.tokenId);
        emit Sold(id, msg.sender, l.price, fee);
    }

    function withdrawFees(address to) external onlyOwner {
        SafeERC20.safeTransfer(paymentToken, to, paymentToken.balanceOf(address(this)));
    }
}
