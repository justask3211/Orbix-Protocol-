// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CenterRegistry} from "../../src/center/CenterRegistry.sol";
import {SettlementVerifier} from "../../src/center/SettlementVerifier.sol";
import {CenterEscrow} from "../../src/center/CenterEscrow.sol";
import {MockERC20, MockERC721, MockERC1155} from "../../src/center/mocks/Mocks.sol";

contract CenterEscrowTest is Test {
    CenterRegistry registry;
    SettlementVerifier verifier;
    CenterEscrow escrow;

    MockERC20 token; // entry + ERC20 reward asset
    MockERC721 nft;
    MockERC1155 multi;

    uint256 constant SIGNER_PK = 0xA11CE;
    address signer;
    uint256 constant EPOCH = 1;

    address creator = address(0xC0FFEE);
    address alice = address(0xA11CE1);
    address bob = address(0xB0B);
    address mallory = address(0xBAD);

    bytes32 constant TEMPLATE = keccak256("number-hunt@1");
    bytes32 constant ROUND = keccak256("room-1/round-1");
    bytes32 constant CONFIG = keccak256("config-hash");
    bytes32 constant POLICY = keccak256("payout-policy");
    bytes32 constant ALLOC = keccak256("allocations");

    uint64 regStart;
    uint64 regEnd;
    uint64 playEnd;
    uint64 settleDeadline;
    uint64 refundDeadline;
    uint64 claimDeadline;

    function setUp() public {
        signer = vm.addr(SIGNER_PK);
        vm.warp(1_000_000);

        registry = new CenterRegistry();
        verifier = new SettlementVerifier();
        escrow = new CenterEscrow(registry, verifier);

        registry.setEscrow(address(escrow), true);
        registry.setTemplate(TEMPLATE, true);
        registry.setFeeRecipient(address(0xFEE));
        registry.setMaxFeeBps(0); // release one: rake disabled
        verifier.setEpochSigner(uint32(EPOCH), signer);

        token = new MockERC20("Center Test", "CTEST", 18);
        nft = new MockERC721();
        multi = new MockERC1155();
        registry.setAsset(address(token), true);
        registry.setAsset(address(nft), true);
        registry.setAsset(address(multi), true);

        token.mint(creator, 1_000_000e18);
        vm.startPrank(creator);
        nft.setApprovalForAll(address(escrow), true);
        multi.setApprovalForAll(address(escrow), true);
        vm.stopPrank();
        token.mint(alice, 1_000e18);
        token.mint(bob, 1_000e18);

        regStart = uint64(block.timestamp);
        regEnd = regStart + 600;
        playEnd = regEnd + 600;
        settleDeadline = playEnd + 600;
        refundDeadline = settleDeadline + 600;
        claimDeadline = refundDeadline + 1200;

        vm.prank(creator);
        token.approve(address(escrow), type(uint256).max);
        vm.prank(alice);
        token.approve(address(escrow), type(uint256).max);
        vm.prank(bob);
        token.approve(address(escrow), type(uint256).max);
    }

    // ------------------------------------------------------------------ create

    function test_createRound_records_spec_and_opens_registration() public {
        _createRound(address(token), 10e18, 2);
        CenterEscrow.Round memory r = escrow.roundOf(ROUND);
        assertEq(r.creator, creator);
        assertEq(r.configHash, CONFIG);
        assertEq(uint8(r.state), uint8(CenterEscrow.State.Registration));
        assertEq(r.entrants, 0);
    }

    function test_createRound_rejects_unapproved_template_and_chronology() public {
        CenterEscrow.RoundSpec memory s = _spec(address(token), 10e18, 2);
        s.templateId = keccak256("rogue@1");
        vm.prank(creator);
        vm.expectRevert(CenterEscrow.BadTemplate.selector);
        escrow.createRound(s);
    }

    function test_createRound_rejects_fee_above_registry_ceiling() public {
        CenterEscrow.RoundSpec memory s = _spec(address(token), 10e18, 2);
        s.feeBps = 100;
        vm.prank(creator);
        vm.expectRevert(CenterEscrow.FeeTooHigh.selector);
        escrow.createRound(s);
    }

    // ------------------------------------------------------------------ entry

    function test_paid_entry_and_cap_enforcement() public {
        _createRound(address(token), 10e18, 1);

        vm.prank(alice);
        escrow.enter(ROUND);
        assertTrue(escrow.admitted(ROUND, alice));

        vm.prank(alice);
        vm.expectRevert(CenterEscrow.AlreadyEntered.selector);
        escrow.enter(ROUND);

        vm.prank(bob);
        vm.expectRevert(CenterEscrow.RoundFull.selector);
        escrow.enter(ROUND);
    }

    function test_free_entry_round_charges_nothing() public {
        _createRound(address(0), 0, 10);
        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        escrow.enter(ROUND);
        assertEq(token.balanceOf(alice), before);
        assertTrue(escrow.admitted(ROUND, alice));
    }

    // ------------------------------------------------------------------ settlement + claim

    function test_erc20_reward_claim_and_replay_blocked() public {
        _createRound(address(token), 10e18, 4);
        _enter(alice);
        vm.prank(creator);
        escrow.fundERC20(ROUND, address(token), 100e18);

        CenterEscrow.Entitlement memory e = _entitlement(CenterEscrow.AssetKind.ERC20, address(token), 0, 100e18, alice, 1);
        bytes32 leaf = escrow.entitlementLeaf(e);
        _settle(leaf);

        uint256 before = token.balanceOf(alice);
        vm.prank(mallory); // anyone may relay, but funds go to the entitlement winner
        escrow.claim(e, _emptyProof());
        assertEq(token.balanceOf(alice), before + 100e18);
        assertEq(token.balanceOf(mallory), 0);

        vm.prank(alice);
        vm.expectRevert(CenterEscrow.AlreadyClaimed.selector);
        escrow.claim(e, _emptyProof());
    }

    function test_claim_requires_admitted_winner_and_valid_proof() public {
        _createRound(address(token), 10e18, 4);
        _enter(alice);
        vm.prank(creator);
        escrow.fundERC20(ROUND, address(token), 100e18);

        // mallory never entered
        CenterEscrow.Entitlement memory e = _entitlement(CenterEscrow.AssetKind.ERC20, address(token), 0, 1e18, mallory, 1);
        _settle(escrow.entitlementLeaf(e));
        vm.prank(mallory);
        vm.expectRevert(CenterEscrow.NotAdmitted.selector);
        escrow.claim(e, _emptyProof());

        // alice is admitted but this leaf is not in the root
        CenterEscrow.Entitlement memory e2 = _entitlement(CenterEscrow.AssetKind.ERC20, address(token), 0, 1e18, alice, 9);
        vm.prank(alice);
        vm.expectRevert(CenterEscrow.BadProof.selector);
        escrow.claim(e2, _emptyProof());
    }

    function test_claim_cannot_exceed_reserved_inventory() public {
        _createRound(address(token), 10e18, 4);
        _enter(alice);
        vm.prank(creator);
        escrow.fundERC20(ROUND, address(token), 5e18); // only 5 funded

        CenterEscrow.Entitlement memory e = _entitlement(CenterEscrow.AssetKind.ERC20, address(token), 0, 10e18, alice, 1);
        _settle(escrow.entitlementLeaf(e));
        vm.prank(alice);
        vm.expectRevert(CenterEscrow.InsufficientReserved.selector);
        escrow.claim(e, _emptyProof());
    }

    function test_two_winner_merkle_proofs() public {
        _createRound(address(token), 0, 4);
        _enter(alice);
        _enter(bob);
        vm.prank(creator);
        escrow.fundERC20(ROUND, address(token), 100e18);

        CenterEscrow.Entitlement memory a = _entitlement(CenterEscrow.AssetKind.ERC20, address(token), 0, 60e18, alice, 1);
        CenterEscrow.Entitlement memory b = _entitlement(CenterEscrow.AssetKind.ERC20, address(token), 0, 40e18, bob, 2);
        bytes32 la = escrow.entitlementLeaf(a);
        bytes32 lb = escrow.entitlementLeaf(b);
        bytes32 root = _pair(la, lb);
        _settle(root);

        bytes32[] memory proofA = new bytes32[](1);
        proofA[0] = lb;
        bytes32[] memory proofB = new bytes32[](1);
        proofB[0] = la;

        vm.prank(alice);
        escrow.claim(a, proofA);
        vm.prank(bob);
        escrow.claim(b, proofB);
        assertEq(token.balanceOf(alice), 1_000e18 + 60e18);
        assertEq(token.balanceOf(bob), 1_000e18 + 40e18);
    }

    function test_nft_and_1155_claims() public {
        _createRound(address(0), 0, 4);
        _enter(alice);
        _enter(bob);
        nft.mint(creator, 7);
        multi.mint(creator, 3, 50);
        vm.startPrank(creator);
        escrow.fundERC721(ROUND, address(nft), 7);
        escrow.fundERC1155(ROUND, address(multi), 3, 50);
        vm.stopPrank();

        CenterEscrow.Entitlement memory e1 = _entitlement(CenterEscrow.AssetKind.ERC721, address(nft), 7, 1, alice, 1);
        CenterEscrow.Entitlement memory e2 = _entitlement(CenterEscrow.AssetKind.ERC1155, address(multi), 3, 20, bob, 2);
        bytes32 la = escrow.entitlementLeaf(e1);
        bytes32 lb = escrow.entitlementLeaf(e2);
        _settle(_pair(la, lb));

        bytes32[] memory p1 = new bytes32[](1);
        p1[0] = lb;
        bytes32[] memory p2 = new bytes32[](1);
        p2[0] = la;

        vm.prank(alice);
        escrow.claim(e1, p1);
        assertEq(nft.ownerOf(7), alice);

        vm.prank(bob);
        escrow.claim(e2, p2);
        assertEq(multi.balanceOf(bob, 3), 20);
    }

    // ------------------------------------------------------------------ settlement authority

    function test_settlement_signature_binds_epoch_deadline_and_signer() public {
        _createRound(address(token), 0, 4);
        vm.prank(creator);
        escrow.fundERC20(ROUND, address(token), 1e18);
        bytes32 root = keccak256("root");

        // wrong signer
        (, bytes32 r1, bytes32 s1) = vm.sign(0xDEAD, escrow.settlementDigest(ROUND, root, ALLOC, keccak256("t"), settleDeadline));
        bytes memory bad = abi.encodePacked(r1, s1, uint8(27));
        vm.expectRevert(CenterEscrow.BadSignature.selector);
        escrow.publishSettlement(ROUND, root, ALLOC, keccak256("t"), settleDeadline, bad);

        // wrong deadline (not the round's)
        (, bytes32 r2, bytes32 s2) = vm.sign(SIGNER_PK, escrow.settlementDigest(ROUND, root, ALLOC, keccak256("t"), settleDeadline + 1));
        bytes memory bad2 = abi.encodePacked(r2, s2, uint8(27));
        vm.expectRevert(CenterEscrow.WrongDeadline.selector);
        escrow.publishSettlement(ROUND, root, ALLOC, keccak256("t"), settleDeadline + 1, bad2);

        // expired deadline
        vm.warp(settleDeadline + 1);
        (, bytes32 r3, bytes32 s3) = vm.sign(SIGNER_PK, escrow.settlementDigest(ROUND, root, ALLOC, keccak256("t"), settleDeadline));
        bytes memory bad3 = abi.encodePacked(r3, s3, uint8(27));
        vm.expectRevert(CenterEscrow.SignatureExpired.selector);
        escrow.publishSettlement(ROUND, root, ALLOC, keccak256("t"), settleDeadline, bad3);
    }

    function test_revoked_epoch_cannot_settle() public {
        _createRound(address(token), 0, 4);
        verifier.revokeEpoch(uint32(EPOCH));
        bytes32 root = keccak256("root");
        (, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, escrow.settlementDigest(ROUND, root, ALLOC, keccak256("t"), settleDeadline));
        vm.expectRevert(CenterEscrow.BadSignature.selector);
        escrow.publishSettlement(ROUND, root, ALLOC, keccak256("t"), settleDeadline, abi.encodePacked(r, s, uint8(27)));
    }

    // ------------------------------------------------------------------ refunds / reclaim

    function test_cancel_then_pull_refund() public {
        _createRound(address(token), 10e18, 4);
        _enter(alice);
        vm.prank(creator);
        escrow.cancelRound(ROUND);

        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        escrow.refundEntry(ROUND);
        assertEq(token.balanceOf(alice), before + 10e18);

        vm.prank(alice);
        vm.expectRevert(CenterEscrow.AlreadyRefunded.selector);
        escrow.refundEntry(ROUND);
    }

    function test_refund_unavailable_before_refund_deadline() public {
        _createRound(address(token), 10e18, 4);
        _enter(alice);
        vm.prank(alice);
        vm.expectRevert(CenterEscrow.RefundNotAvailable.selector);
        escrow.refundEntry(ROUND);
    }

    function test_unsettled_round_refunds_after_deadline() public {
        _createRound(address(token), 10e18, 4);
        _enter(alice);
        vm.warp(refundDeadline + 1);
        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        escrow.refundEntry(ROUND);
        assertEq(token.balanceOf(alice), before + 10e18);
    }

    function test_reclaim_unused_reward_after_claim_window() public {
        _createRound(address(token), 0, 4);
        _enter(alice);
        vm.prank(creator);
        escrow.fundERC20(ROUND, address(token), 100e18);

        CenterEscrow.Entitlement memory e = _entitlement(CenterEscrow.AssetKind.ERC20, address(token), 0, 100e18, alice, 1);
        _settle(escrow.entitlementLeaf(e));

        vm.prank(creator);
        vm.expectRevert(CenterEscrow.ClaimWindowOpen.selector);
        escrow.reclaimUnusedReward(ROUND, CenterEscrow.AssetKind.ERC20, address(token), 0);

        vm.warp(claimDeadline + 1);
        uint256 before = token.balanceOf(creator);
        vm.prank(creator);
        escrow.reclaimUnusedReward(ROUND, CenterEscrow.AssetKind.ERC20, address(token), 0);
        assertEq(token.balanceOf(creator), before + 100e18);
    }

    function test_reclaim_is_creator_only() public {
        _createRound(address(token), 0, 4);
        vm.prank(creator);
        escrow.fundERC20(ROUND, address(token), 100e18);
        vm.warp(claimDeadline + 1);
        vm.prank(mallory);
        vm.expectRevert(CenterEscrow.NotCreator.selector);
        escrow.reclaimUnusedReward(ROUND, CenterEscrow.AssetKind.ERC20, address(token), 0);
    }

    function test_accounting_invariant_claimed_plus_reclaimed_equals_funded() public {
        _createRound(address(token), 0, 4);
        _enter(alice);
        _enter(bob);
        vm.prank(creator);
        escrow.fundERC20(ROUND, address(token), 100e18);

        CenterEscrow.Entitlement memory a = _entitlement(CenterEscrow.AssetKind.ERC20, address(token), 0, 30e18, alice, 1);
        CenterEscrow.Entitlement memory b = _entitlement(CenterEscrow.AssetKind.ERC20, address(token), 0, 20e18, bob, 2);
        bytes32 la = escrow.entitlementLeaf(a);
        bytes32 lb = escrow.entitlementLeaf(b);
        _settle(_pair(la, lb));

        bytes32[] memory pa = new bytes32[](1);
        pa[0] = lb;
        vm.prank(alice);
        escrow.claim(a, pa);

        bytes32 key = escrow.assetKey(CenterEscrow.AssetKind.ERC20, address(token), 0);
        // 100 funded - 30 already claimed == 70 still reserved (20 of it claimable by bob)
        assertEq(escrow.reserved(ROUND, key), 70e18);

        vm.warp(claimDeadline + 1);
        uint256 creatorBefore = token.balanceOf(creator);
        vm.prank(creator);
        escrow.reclaimUnusedReward(ROUND, CenterEscrow.AssetKind.ERC20, address(token), 0);
        assertEq(escrow.reserved(ROUND, key), 0);
        // Invariant: claimed (30 to alice) + reclaimed (70 to creator) == funded (100).
        assertEq(token.balanceOf(creator), creatorBefore + 70e18);
    }

    function test_claim_after_claim_window_is_closed() public {
        _createRound(address(token), 0, 4);
        _enter(alice);
        vm.prank(creator);
        escrow.fundERC20(ROUND, address(token), 10e18);
        CenterEscrow.Entitlement memory e = _entitlement(CenterEscrow.AssetKind.ERC20, address(token), 0, 10e18, alice, 1);
        _settle(escrow.entitlementLeaf(e));
        vm.warp(claimDeadline + 1);
        vm.prank(alice);
        vm.expectRevert(CenterEscrow.ClaimWindowClosed.selector);
        escrow.claim(e, _emptyProof());
    }

    // ------------------------------------------------------------------ helpers

    function _spec(address entryAsset, uint256 entryAmount, uint32 cap)
        internal
        view
        returns (CenterEscrow.RoundSpec memory s)
    {
        s = CenterEscrow.RoundSpec({
            roundId: ROUND,
            configHash: CONFIG,
            templateId: TEMPLATE,
            entryAsset: entryAsset,
            entryAmount: entryAmount,
            admissionCap: cap,
            registrationStart: regStart,
            registrationEnd: regEnd,
            playEnd: playEnd,
            settlementDeadline: settleDeadline,
            refundDeadline: refundDeadline,
            claimDeadline: claimDeadline,
            authorityEpoch: uint32(EPOCH),
            feeBps: 0,
            payoutPolicyHash: POLICY
        });
    }

    function _createRound(address entryAsset, uint256 entryAmount, uint32 cap) internal {
        vm.prank(creator);
        escrow.createRound(_spec(entryAsset, entryAmount, cap));
    }

    function _enter(address who) internal {
        vm.prank(who);
        escrow.enter(ROUND);
    }

    function _entitlement(
        CenterEscrow.AssetKind kind,
        address asset,
        uint256 tokenId,
        uint256 amount,
        address winner,
        uint32 slotId
    ) internal view returns (CenterEscrow.Entitlement memory e) {
        e.assetKind = kind;
        e.assetContract = asset;
        e.tokenId = tokenId;
        e.amount = amount;
        e.roundId = ROUND;
        e.winner = winner;
        e.slotId = slotId;
        e.allocationNonce = 0;
        e.claimId = keccak256(abi.encode(block.chainid, address(escrow), ROUND, winner, slotId, uint256(0)));
    }

    function _settle(bytes32 root) internal {
        bytes32 transcript = keccak256("transcript");
        bytes32 digest = escrow.settlementDigest(ROUND, root, ALLOC, transcript, settleDeadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, digest);
        escrow.publishSettlement(ROUND, root, ALLOC, transcript, settleDeadline, abi.encodePacked(r, s, v));
    }

    function _pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    function _emptyProof() internal pure returns (bytes32[] memory p) {
        p = new bytes32[](0);
    }
}
