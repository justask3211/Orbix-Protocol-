// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Orbix666 — the 666-supply NFT with a three-way hunt mint.
/// Tier HUMAN (222): off-chain click-hunt server issues signed claims for winners.
/// Tier BOT   (222): open, but requires burning BURN_PRICE of the ecosystem token for an access slot.
/// Tier GPU   (222): proof-of-work — keccak256(nonce, salt, minter) < difficulty.
/// Holders get: swap fee discount (feeDiscountBps), launchpad priority (isPriority), staking boost.
contract Orbix666 is ERC721, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant SUPPLY = 666;
    uint256 public constant TIER_HUMAN = 222;
    uint256 public constant TIER_BOT = 222;
    uint256 public constant TIER_GPU = 222;

    enum Tier {
        HUMAN,
        BOT,
        GPU
    }
    mapping(Tier => uint256) public minted;
    uint256 public totalMinted;

    IERC20 public immutable burnToken;
    uint256 public botBurnPrice = 25_000 ether; // adjustable by owner pre-mint
    address public claimSigner; // signs human-tier winning claims
    bytes32 public gpuSalt; // set once at start, prevents grinding pre-knowledge
    uint256 public gpuDifficulty = 2 ** 240; // hash must be BELOW this
    string public baseURI;

    mapping(uint256 => Tier) public tokenTier;
    mapping(address => bool) public usedHumanClaim;

    event Minted(address indexed to, uint256 indexed tokenId, Tier tier);
    event HumanWinner(address indexed winner, bytes32 seed);

    error SoldOut(Tier tier);
    error SoldOutTotal();
    error BadClaim();
    error AlreadyClaimed();
    error DifficultyNotMet();
    error SaltLocked();

    constructor(address _burnToken, address _claimSigner, string memory _baseURI)
        ERC721("Orbix 666", "ORBIX666")
        Ownable(msg.sender)
    {
        burnToken = IERC20(_burnToken);
        claimSigner = _claimSigner;
        baseURI = _baseURI;
    }

    // ---------- Tier 1: HUMAN — off-chain click-hunt, server signs winner + seed ----------
    function mintHuman(uint256 luckyNumber, uint256 ts, bytes32 seed, bytes calldata sig) external nonReentrant {
        if (totalMinted >= SUPPLY) revert SoldOutTotal();
        if (minted[Tier.HUMAN] >= TIER_HUMAN) revert SoldOut(Tier.HUMAN);
        if (usedHumanClaim[msg.sender]) revert AlreadyClaimed();
        if (block.timestamp > ts + 10 minutes) revert BadClaim();

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32", keccak256(abi.encodePacked(msg.sender, luckyNumber, ts, seed))
            )
        );
        require(_recover(digest, sig) == claimSigner, BadClaim());

        // winning numbers are 6-digit primes chosen by server RNG; server attests by signing
        usedHumanClaim[msg.sender] = true;
        minted[Tier.HUMAN]++;
        _mintTo(msg.sender, Tier.HUMAN);
        emit HumanWinner(msg.sender, seed);
    }

    // ---------- Tier 2: BOT — burn tokens for access, open mint ----------
    function mintBot() external nonReentrant {
        if (totalMinted >= SUPPLY) revert SoldOutTotal();
        if (minted[Tier.BOT] >= TIER_BOT) revert SoldOut(Tier.BOT);
        ERC20Burnable(address(burnToken)).burnFrom(msg.sender, botBurnPrice);
        minted[Tier.BOT]++;
        _mintTo(msg.sender, Tier.BOT);
    }

    // ---------- Tier 3: GPU — proof-of-work ----------
    function mintGPU(uint256 nonce) external nonReentrant {
        if (totalMinted >= SUPPLY) revert SoldOutTotal();
        if (minted[Tier.GPU] >= TIER_GPU) revert SoldOut(Tier.GPU);
        bytes32 h = keccak256(abi.encodePacked(nonce, gpuSalt, msg.sender));
        if (uint256(h) >= gpuDifficulty) revert DifficultyNotMet();
        minted[Tier.GPU]++;
        _mintTo(msg.sender, Tier.GPU);
    }

    function _mintTo(address to, Tier tier) internal {
        uint256 tokenId = ++totalMinted;
        tokenTier[tokenId] = tier;
        _mint(to, tokenId);
        emit Minted(to, tokenId, tier);
    }

    // ---------- Utility hooks (used by ecosystem contracts) ----------
    /// @notice fee discount in bps (out of 10_000) — 25% discount for holders
    function feeDiscountBps(address holder) external view returns (uint256) {
        return balanceOf(holder) > 0 ? 2500 : 0;
    }

    function isPriority(address holder) external view returns (bool) {
        return balanceOf(holder) > 0;
    }

    function tierOf(uint256 tokenId) external view returns (Tier) {
        return tokenTier[tokenId];
    }

    // ---------- Admin ----------
    function setBotBurnPrice(uint256 p) external onlyOwner {
        botBurnPrice = p;
    }

    function setClaimSigner(address s) external onlyOwner {
        claimSigner = s;
    }

    function lockSalt(bytes32 s) external onlyOwner {
        if (gpuSalt != bytes32(0)) revert SaltLocked();
        gpuSalt = s;
    }

    function setDifficulty(uint256 d) external onlyOwner {
        gpuDifficulty = d;
    }

    function setBaseURI(string calldata u) external onlyOwner {
        baseURI = u;
    }

    function _baseURI() internal view override returns (string memory) {
        return baseURI;
    }

    function _recover(bytes32 digest, bytes memory sig) internal pure returns (address) {
        require(sig.length == 65);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) v += 27;
        return ecrecover(digest, v, r, s);
    }
}
