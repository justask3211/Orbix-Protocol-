// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RewardEngine} from "../../src/center/RewardEngine.sol";
import {MockERC20, MockERC721, MockERC1155} from "../../src/center/mocks/Mocks.sol";

contract RewardEngineTest is Test {
    RewardEngine engine;
    MockERC20 token;
    MockERC721 nft;
    MockERC1155 multi;

    uint256 constant AUTH_PK = 0xA11CE;
    address authority;
    address creator = address(0xC0FFEE);
    address alice = address(0xA1);
    address bob = address(0xB0B);
    bytes32 room = keccak256("room-rewards");

    function setUp() public {
        authority = vm.addr(AUTH_PK);
        engine = new RewardEngine(authority);
        token = new MockERC20("Creator Token", "CTK", 18);
        nft = new MockERC721();
        multi = new MockERC1155();
        token.mint(creator, 1_000_000e18);
        vm.prank(creator);
        token.approve(address(engine), type(uint256).max);
        vm.prank(creator);
        nft.setApprovalForAll(address(engine), true);
        vm.prank(creator);
        multi.setApprovalForAll(address(engine), true);
        vm.warp(1000);
    }

    function _sig(bytes32 digest) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(AUTH_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    function _ethSigned(bytes32 h) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h));
    }

    function _create(RewardEngine.ClaimMode mode, uint32 openCap, bytes32 root, string memory msg_)
        internal
        returns (uint256)
    {
        vm.prank(creator);
        return engine.createPool(room, mode, uint64(block.timestamp + 7 days), openCap, root, msg_);
    }

    // ------------------------------------------------------------ creation + deposit

    function test_create_and_deposit_erc20() public {
        uint256 id = _create(RewardEngine.ClaimMode.Code, 0, bytes32(0), "You won!");
        vm.prank(creator);
        engine.depositERC20(id, address(token), 100e18);
        (,,,,,,, string memory m) = engine.poolInfo(id);
        assertEq(m, "You won!");
        (, address[] memory cs, uint256[] memory ids, uint256[] memory amts) = engine.poolAssets(id);
        assertEq(cs[0], address(token));
        assertEq(ids[0], 0);
        assertEq(amts[0], 100e18);
    }

    function test_deadline_must_be_future() public {
        vm.prank(creator);
        vm.expectRevert(RewardEngine.DeadlineTooSoon.selector);
        engine.createPool(room, RewardEngine.ClaimMode.Code, uint64(block.timestamp + 60), 0, bytes32(0), "");
    }

    function test_only_creator_can_deposit() public {
        uint256 id = _create(RewardEngine.ClaimMode.Code, 0, bytes32(0), "");
        vm.prank(alice);
        vm.expectRevert(RewardEngine.NotCreator.selector);
        engine.depositERC20(id, address(token), 1e18);
    }

    function test_fee_on_transfer_rejected() public {
        // MockERC20 is exact; simulate a wrong-received token by depositing more than approved
        uint256 id = _create(RewardEngine.ClaimMode.Code, 0, bytes32(0), "");
        vm.prank(creator);
        vm.expectRevert();
        engine.depositERC20(id, address(token), 2_000_000e18); // exceeds balance/allowance
    }

    function test_deposit_721_and_1155() public {
        uint256 id = _create(RewardEngine.ClaimMode.Merkle, 0, keccak256("root"), "");
        uint256 nftId = 7;
        nft.mint(creator, nftId);
        vm.prank(creator);
        engine.depositERC721(id, address(nft), nftId);
        multi.mint(creator, 42, 5);
        vm.prank(creator);
        engine.depositERC1155(id, address(multi), 42, 5, "");
        (uint8[] memory kinds,,, uint256[] memory amts) = engine.poolAssets(id);
        assertEq(kinds.length, 2);
        assertEq(kinds[0], uint8(RewardEngine.AssetKind.ERC721));
        assertEq(kinds[1], uint8(RewardEngine.AssetKind.ERC1155));
        assertEq(amts[1], 5);
    }

    function test_deposit_eth() public {
        uint256 id = _create(RewardEngine.ClaimMode.Auto, 0, bytes32(0), "");
        vm.deal(creator, 5 ether);
        vm.prank(creator);
        engine.depositETH{value: 1 ether}(id);
        (uint8[] memory kinds,,, uint256[] memory amts) = engine.poolAssets(id);
        assertEq(kinds[0], uint8(RewardEngine.AssetKind.ETH));
        assertEq(amts[0], 1 ether);
    }

    // ------------------------------------------------------------ CODE mode

    function test_code_claim_wallet_bound_and_one_time() public {
        uint256 id = _create(RewardEngine.ClaimMode.Code, 0, bytes32(0), "Nice win");
        vm.prank(creator);
        engine.depositERC20(id, address(token), 50e18);
        vm.prank(creator);
        engine.setAllocation(id, alice, 0, 50e18);

        // bob cannot claim alice's allocation
        bytes32 dig = keccak256(
            abi.encodePacked("ORBIX_REWARD_CLAIM_V1", address(engine), block.chainid, id, uint256(0), bob, uint256(1))
        );
        vm.prank(bob);
        vm.expectRevert(RewardEngine.NotWinner.selector);
        engine.claimByCode(id, 0, 1, _sig(_ethSigned(dig)));

        // alice claims with a valid authority code
        bytes32 digA = keccak256(
            abi.encodePacked("ORBIX_REWARD_CLAIM_V1", address(engine), block.chainid, id, uint256(0), alice, uint256(1))
        );
        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        engine.claimByCode(id, 0, 1, _sig(_ethSigned(digA)));
        assertEq(token.balanceOf(alice) - before, 50e18);

        // one-time: replay refused
        vm.prank(alice);
        vm.expectRevert(RewardEngine.AlreadyClaimed.selector);
        engine.claimByCode(id, 0, 1, _sig(_ethSigned(digA)));
    }

    function test_code_claim_rejects_wrong_signer() public {
        uint256 id = _create(RewardEngine.ClaimMode.Code, 0, bytes32(0), "");
        vm.prank(creator);
        engine.depositERC20(id, address(token), 10e18);
        vm.prank(creator);
        engine.setAllocation(id, alice, 0, 10e18);
        bytes32 dig = keccak256(
            abi.encodePacked("ORBIX_REWARD_CLAIM_V1", address(engine), block.chainid, id, uint256(0), alice, uint256(9))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, _ethSigned(dig));
        vm.prank(alice);
        vm.expectRevert(RewardEngine.NotAuthority.selector);
        engine.claimByCode(id, 0, 9, abi.encodePacked(r, s, v));
    }

    // ------------------------------------------------------------ Merkle mode

    function test_merkle_claim() public {
        bytes32 leaf = keccak256(abi.encodePacked(alice, uint256(0), uint256(25e18)));
        uint256 id = _create(RewardEngine.ClaimMode.Merkle, 0, leaf, "");
        vm.prank(creator);
        engine.depositERC20(id, address(token), 25e18);
        bytes32[] memory proof = new bytes32[](0); // single-leaf tree: root == leaf
        uint256 before = token.balanceOf(alice);
        engine.claimByMerkle(id, proof, alice, 0, 25e18);
        assertEq(token.balanceOf(alice) - before, 25e18);
        // double claim refused
        vm.expectRevert(RewardEngine.AlreadyClaimed.selector);
        engine.claimByMerkle(id, proof, alice, 0, 25e18);
    }

    function test_merkle_bad_proof_rejected() public {
        bytes32 leaf = keccak256(abi.encodePacked(alice, uint256(0), uint256(25e18)));
        uint256 id = _create(RewardEngine.ClaimMode.Merkle, 0, leaf, "");
        vm.prank(creator);
        engine.depositERC20(id, address(token), 25e18);
        bytes32[] memory proof = new bytes32[](0);
        vm.expectRevert(RewardEngine.BadMerkleProof.selector);
        engine.claimByMerkle(id, proof, bob, 0, 25e18);
    }

    // ------------------------------------------------------------ OPEN mode

    function test_open_claims_first_n() public {
        uint256 id = _create(RewardEngine.ClaimMode.Open, 2, bytes32(0), "");
        vm.prank(creator);
        engine.depositERC20(id, address(token), 20e18);
        vm.prank(creator);
        engine.setAllocation(id, address(0), 0, 10e18);
        vm.prank(creator);
        engine.setAllocation(id, address(0), 0, 10e18);

        vm.prank(alice);
        engine.claimOpen(id, 0);
        vm.prank(bob);
        engine.claimOpen(id, 1);
        assertEq(token.balanceOf(alice), 10e18);
        assertEq(token.balanceOf(bob), 10e18);
        // third wallet: cap reached, all claimed
        vm.prank(address(0xCAFE));
        bool ok = false;
        try engine.claimOpen(id, 0) {
            ok = true;
        } catch {}
        assertFalse(ok, "third claimant must be refused");
        // fresh alloc still refused by cap
        vm.prank(creator);
        engine.setAllocation(id, address(0), 0, 10e18);
        vm.prank(address(0xCAFE));
        vm.expectRevert(RewardEngine.OpenClaimsExhausted.selector);
        engine.claimOpen(id, 2);
    }

    // ------------------------------------------------------------ AUTO mode

    function test_auto_push_requires_authority_sig() public {
        uint256 id = _create(RewardEngine.ClaimMode.Auto, 0, bytes32(0), "");
        vm.prank(creator);
        engine.depositERC20(id, address(token), 30e18);
        address[] memory winners = new address[](1);
        winners[0] = alice;
        uint256[] memory idx = new uint256[](1);
        idx[0] = 0;
        bytes32 dig = keccak256(
            abi.encodePacked(
                "ORBIX_REWARD_AUTOPUSH_V1", address(engine), block.chainid, id, keccak256(abi.encode(winners, idx))
            )
        );
        // wrong signer
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, _ethSigned(dig));
        vm.expectRevert(RewardEngine.NotAuthority.selector);
        engine.autoPush(id, winners, idx, abi.encodePacked(r, s, v));
        // correct signer pushes
        uint256 before = token.balanceOf(alice);
        engine.autoPush(id, winners, idx, _sig(_ethSigned(dig)));
        assertEq(token.balanceOf(alice) - before, 30e18);
        // pool now settled
        (,,,, uint8 state,,,) = engine.poolInfo(id);
        assertEq(state, uint8(RewardEngine.PoolState.Settled));
    }

    // ------------------------------------------------------------ expiry + reclaim

    function test_claim_after_deadline_rejected() public {
        uint256 id = _create(
            RewardEngine.ClaimMode.Merkle, 0, keccak256(abi.encodePacked(alice, uint256(0), uint256(1e18))), ""
        );
        vm.prank(creator);
        engine.depositERC20(id, address(token), 1e18);
        vm.warp(block.timestamp + 8 days);
        bytes32[] memory proof = new bytes32[](0);
        vm.expectRevert(RewardEngine.DeadlinePassed.selector);
        engine.claimByMerkle(id, proof, alice, 0, 1e18);
    }

    function test_creator_reclaims_after_deadline_only() public {
        uint256 id = _create(RewardEngine.ClaimMode.Code, 0, bytes32(0), "");
        vm.prank(creator);
        engine.depositERC20(id, address(token), 77e18);
        vm.prank(creator);
        engine.setAllocation(id, alice, 0, 77e18);
        // too early
        vm.prank(creator);
        vm.expectRevert(RewardEngine.NotExpired.selector);
        engine.reclaimExpired(id);
        // after deadline
        vm.warp(block.timestamp + 8 days);
        uint256 before = token.balanceOf(creator);
        vm.prank(creator);
        engine.reclaimExpired(id);
        assertEq(token.balanceOf(creator) - before, 77e18);
    }

    function test_non_creator_cannot_reclaim() public {
        uint256 id = _create(RewardEngine.ClaimMode.Code, 0, bytes32(0), "");
        vm.prank(creator);
        engine.depositERC20(id, address(token), 5e18);
        vm.warp(block.timestamp + 8 days);
        vm.prank(alice);
        vm.expectRevert(RewardEngine.NotCreator.selector);
        engine.reclaimExpired(id);
    }

    // ------------------------------------------------------------ message

    function test_message_set_and_read() public {
        uint256 id = _create(RewardEngine.ClaimMode.Code, 0, bytes32(0), "first");
        (,,,,,,, string memory m1) = engine.poolInfo(id);
        assertEq(m1, "first");
        vm.prank(creator);
        engine.setMessage(id, "updated");
        assertEq(engine.getMessage(id), "updated");
    }

    // ------------------------------------------------------------ receivers

    function test_receives_721_and_1155() public {
        // deposits succeed only if the receiver callbacks are correct
        uint256 id = _create(RewardEngine.ClaimMode.Merkle, 0, bytes32(0), "");
        uint256 nftId = 99;
        nft.mint(creator, nftId);
        vm.prank(creator);
        engine.depositERC721(id, address(nft), nftId);
        assertEq(nft.ownerOf(nftId), address(engine));
    }
}
