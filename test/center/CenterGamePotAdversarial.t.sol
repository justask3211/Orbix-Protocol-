// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CenterGamePot} from "../../src/center/CenterGamePot.sol";
import {MockERC20, MockERC721} from "../../src/center/mocks/Mocks.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/// E13 adversarial suite: malicious NFT callbacks and fee-on-transfer assets
/// against CenterGamePot v2.
///
/// A1: an NFT whose onERC721Received re-enters the pot must not be able to
///     drain a reward, re-settle, double-claim, or corrupt the committed ledger.
/// A2: a fee-on-transfer reward token cannot trick lockRewardERC20 into booking
///     more committed value than the pot actually received.
contract CenterGamePotAdversarialTest is Test {
    CenterGamePot pot; MockERC20 token; MockERC721 nft;
    uint256 constant AUTH_PK = 0xA11CE;
    address authority; address treasury = address(0xBEEF);
    address creator = address(0xC0FFEE); address player = address(0xA11CE1);
    address winner = address(0xA11CE2);
    bytes32 room;

    function setUp() public {
        authority = vm.addr(AUTH_PK);
        pot = new CenterGamePot(authority, treasury, 0);
        token = new MockERC20("T", "T", 18);
        nft = new MockERC721();
        token.mint(creator, 1000e18);
        token.mint(player, 1000e18);
        vm.prank(creator); token.approve(address(pot), type(uint256).max);
        vm.prank(player); token.approve(address(pot), type(uint256).max);
        vm.warp(1000);
    }

    function _sig(bytes32 digest) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(AUTH_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    // ------------------------------------------------------------------ A1

    /// The reentrant receiver tries, during the reward payout, to re-run settle
    /// and to claim the same NFT again. Both must fail and leave state sane.
    function test_reentrant_nft_receiver_cannot_reenter_settle_or_steal() public {
        ReentrantNFT evil = new ReentrantNFT(pot, authority, AUTH_PK);
        room = keccak256("evil-room");

        vm.prank(creator);
        pot.openRoom(room, creator, 0, address(0), 0, CenterGamePot.Mode.Auto, uint64(block.timestamp + 1000));
        evil.mintTo(creator);
        vm.prank(creator);
        evil.approve(address(pot), 1);
        vm.prank(creator);
        pot.lockRewardNFT(room, address(evil), 1);

        vm.prank(player);
        pot.enter(room);

        address[] memory winners = new address[](1);
        winners[0] = winner;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 0;
        address[] memory rw = new address[](1);
        rw[0] = winner;
        uint256[] memory ri = new uint256[](1);
        ri[0] = 0;
        bytes32 dig = pot.settlementDigest(room, winners, amounts, rw, ri);
        bytes memory sig = _sig(dig);

        // reentrancy fires inside the payout; it expects its attacks to fail
        evil.expectAttack(); // arms the callback
        pot.settle(room, winners, amounts, rw, ri, sig);

        // the NFT paid out exactly once and the room is settled
        assertEq(evil.ownerOf(1), winner, "NFT must reach the winner exactly once");
        assertTrue(pot.settleDigestUsed(room, dig));
        // a second settle is still refused after the reentrancy attempt
        vm.expectRevert(CenterGamePot.AlreadySettled.selector);
        pot.settle(room, winners, amounts, rw, ri, sig);
    }

    // ------------------------------------------------------------------ A2

    /// A "token" that keeps half of every transfer must not be bookable as a
    /// full-value reward: lockRewardERC20 verifies received == requested.
    function test_fee_on_transfer_reward_reverts_on_partial_delivery() public {
        SkimmingToken skim = new SkimmingToken();
        room = keccak256("skim-room");
        skim.mint(creator, 1000e18);
        vm.prank(creator);
        skim.approve(address(pot), type(uint256).max);

        vm.prank(creator);
        pot.openRoom(room, creator, 0, address(skim), 0, CenterGamePot.Mode.Manual, uint64(block.timestamp + 1000));

        vm.prank(creator);
        vm.expectRevert(CenterGamePot.ZeroAmount.selector);
        pot.lockRewardERC20(room, address(skim), 100e18);

        // nothing was booked: committed stays 0 for the skimming token
        assertEq(pot.tokenCommitted(address(skim)), 0);
    }

    /// Entry side: a fee-on-transfer entry token books only what arrived.
    function test_fee_on_transfer_entry_books_actual_amount() public {
        SkimmingToken skim = new SkimmingToken();
        room = keccak256("skim-entry");
        skim.mint(player, 100e18);
        vm.prank(player);
        skim.approve(address(pot), type(uint256).max);

        vm.prank(creator);
        pot.openRoom(room, creator, 0, address(skim), 40e18, CenterGamePot.Mode.Manual, uint64(block.timestamp + 1000));
        vm.prank(player);
        pot.enter(room);

        // skimmer keeps 50%: pot must hold and book exactly 20e18, not 40e18
        assertEq(skim.balanceOf(address(pot)), 20e18);
        assertEq(pot.tokenCommitted(address(skim)), 20e18);
    }
}

/// NFT that re-enters the pot from onERC721Received while it is paying out.
contract ReentrantNFT is MockERC721, IERC721Receiver {
    CenterGamePot public pot;
    address public authority;
    uint256 public authPk;
    bool public armed;
    bool public attacked;

    constructor(CenterGamePot pot_, address authority_, uint256 authPk_) MockERC721() {
        pot = pot_;
        authority = authority_;
        authPk = authPk_;
    }

    function expectAttack() external { armed = true; }

    function mintTo(address to) external { _mint(to, 1); }

    function onERC721Received(address, address, uint256, bytes calldata)
        external override returns (bytes4)
    {
        if (armed && !attacked) {
            attacked = true;
            _attack();
        }
        return this.onERC721Received.selector;
    }

    function _attack() internal {
        // Attack 1: re-settle attempt mid-payout with an empty signature.
        address[] memory winners = new address[](1);
        winners[0] = address(this);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 0;
        bytes32 dig = pot.settlementDigest(keccak256("r"), winners, amounts, new address[](0), new uint256[](0));
        try pot.settle(keccak256("r"), winners, amounts, new address[](0), new uint256[](0), "") {
            revert("reentrancy: re-settle succeeded");
        } catch {}

        // Attack 2: double-claim the same locked NFT mid-payout.
        try pot.claimReward(keccak256("evil-room"), 0, address(this), 0, "") {
            revert("reentrancy: reward double-claim succeeded");
        } catch {}
    }
}

/// Token that keeps half of every transfer: fee-on-transfer adversary.
contract SkimmingToken {
    string public constant name = "Skim";
    string public constant symbol = "SKM";
    uint8 public constant decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        return _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        uint256 kept = amount / 2;              // skims half of every transfer
        balanceOf[from] -= amount;
        balanceOf[to] += amount - kept;
        balanceOf[address(this)] += kept;
        return true;
    }
}
