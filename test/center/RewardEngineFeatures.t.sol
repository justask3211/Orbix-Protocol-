// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20,MockERC721,MockERC1155} from "../../src/center/mocks/Mocks.sol";
import {RewardEngine} from "../../src/center/RewardEngine.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

contract NoOutgoingNFT is MockERC721 {
    bool public blockOutgoing;
    function setBlockOutgoing() external { blockOutgoing = true; }
    function safeTransferFrom(address from, address to, uint256 id, bytes memory data) public override {
        if (!blockOutgoing) super.safeTransferFrom(from, to, id, data);
    }
}

contract DynamicRewardFee is MockERC20 {
    bool public feeEnabled;
    constructor() MockERC20("Dynamic", "DYN", 18) {}
    function enableFee() external { feeEnabled = true; }
    function _update(address from, address to, uint256 value) internal override {
        if (feeEnabled && from != address(0) && to != address(0)) {
            super._update(from, address(0xdead), value/100);
            super._update(from, to, value-value/100);
        } else super._update(from, to, value);
    }
}

contract BurnableRewardNFT is MockERC721 {
    function burn(uint256 id) external {
        require(ownerOf(id) == msg.sender);
        _burn(id);
    }
}

contract BurnRewardOnReceipt is IERC721Receiver {
    function onERC721Received(address, address, uint256 id, bytes calldata) external returns(bytes4) {
        BurnableRewardNFT(msg.sender).burn(id);
        return this.onERC721Received.selector;
    }
}

/// Receiver forwarding is a legitimate receipt flow, not a short payment.
contract ForwardRewardNFT is IERC721Receiver {
    address immutable destination;
    constructor(address to) { destination = to; }
    function onERC721Received(address, address, uint256 id, bytes calldata) external returns (bytes4) {
        IERC721(msg.sender).safeTransferFrom(address(this), destination, id);
        return this.onERC721Received.selector;
    }
}

contract RewardEngineFeaturesTest is Test {
    RewardEngine engine;
    MockERC20 token;
    MockERC721 nft;
    MockERC1155 multi;
    uint256 constant AUTH_PK=0xA11CE;
    address authority;
    address creator=address(0xC0FFEE);
    address alice=address(0xA1);
    address bob=address(0xB0B);
    function setUp() public {
        vm.warp(1000);authority=vm.addr(AUTH_PK);engine=new RewardEngine(authority);
        token=new MockERC20("T","T",18);nft=new MockERC721();multi=new MockERC1155();
        token.mint(creator,1000);
        vm.prank(creator);token.approve(address(engine),1000);
        vm.prank(creator);multi.setApprovalForAll(address(engine),true);
    }
    function _create(RewardEngine.ClaimMode mode,uint32 cap,bytes32 root,string memory message) internal returns(uint256) {
        vm.prank(creator);return engine.createPool(keccak256("room"),mode,uint64(block.timestamp+7 days),cap,root,message);
    }
    function _ethSigned(bytes32 digest) internal pure returns(bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32",digest));
    }
    function _sig(bytes32 digest) internal returns(bytes memory) {
        (uint8 v,bytes32 r,bytes32 s)=vm.sign(AUTH_PK,digest);return abi.encodePacked(r,s,v);
    }
    function depositKinds(uint256 id) internal {
        vm.startPrank(creator);
        token.approve(address(engine), 100);
        engine.depositERC20(id, address(token), 100);
        nft.setApprovalForAll(address(engine), false);
        nft.mint(creator, 701);
        nft.approve(address(engine), 701);
        engine.depositERC721(id, address(nft), 701);
        multi.mint(creator, 55, 10);
        engine.depositERC1155(id, address(multi), 55, 10, "");
        vm.deal(creator, 100);
        engine.depositETH{value:100}(id);
        vm.stopPrank();
        assertEq(token.allowance(creator, address(engine)), 0);
        assertFalse(nft.isApprovedForAll(creator, address(engine)));
        assertEq(nft.getApproved(701), address(0));
    }

    function codeSignature(uint256 id, uint256 slot, address who) internal returns (bytes memory) {
        return _sig(_ethSigned(keccak256(abi.encodePacked("ORBIX_REWARD_CLAIM_V1", address(engine),
            block.chainid, id, slot, who, slot+1))));
    }

    function assertDelivered(address who) internal view {
        assertEq(token.balanceOf(who), 100);
        assertEq(nft.ownerOf(701), who);
        assertEq(multi.balanceOf(who, 55), 10);
        assertEq(who.balance, 100);
    }

    function test_feature_code_claim_later_all_asset_kinds_one_pool() public {
        uint256 id = _create(RewardEngine.ClaimMode.Code, 0, 0, "");
        depositKinds(id);
        uint256[4] memory amounts = [uint256(100),1,10,100];
        for (uint256 i; i<4; i++) { vm.prank(creator); engine.setAllocation(id, alice, i, amounts[i]); }
        vm.warp(block.timestamp + 1 days);
        for (uint256 i; i<4; i++) {
            bytes memory signature = codeSignature(id, i, alice);
            vm.prank(alice); engine.claimByCode(id, i, i+1, signature);
            assertEq(engine.reserved(id, i), 0);
        }
        assertDelivered(alice);
        assertEq(engine.poolCount(), 1);
    }

    function test_feature_auto_atomic_push_all_asset_kinds_one_pool() public {
        uint256 id = _create(RewardEngine.ClaimMode.Auto, 0, 0, "");
        depositKinds(id);
        address[] memory winners = new address[](4);
        uint256[] memory indices = new uint256[](4);
        for (uint256 i; i<4; i++) { winners[i]=alice; indices[i]=i; }
        bytes memory signature = _sig(_ethSigned(keccak256(abi.encodePacked("ORBIX_REWARD_AUTOPUSH_V1",
            address(engine), block.chainid, id, keccak256(abi.encode(winners,indices))))));
        vm.prank(alice); engine.autoPush(id, winners, indices, signature);
        assertDelivered(alice);
        assertEq(engine.poolCount(), 1);
    }

    function test_feature_open_mixed_assets_first_four_distinct_wallets() public {
        uint256 id = _create(RewardEngine.ClaimMode.Open, 4, 0, "");
        depositKinds(id);
        uint256[4] memory amounts = [uint256(100),1,10,100];
        for (uint256 i; i<4; i++) {
            vm.prank(creator); engine.setAllocation(id, address(0), i, amounts[i]);
            vm.prank(address(uint160(0x100+i))); engine.claimOpen(id, i);
        }
        assertEq(token.balanceOf(address(0x100)),100);
        assertEq(nft.ownerOf(701),address(0x101));
        assertEq(multi.balanceOf(address(0x102),55),10);
        assertEq(address(0x103).balance,100);
    }

    function test_feature_merkle_mixed_assets_fixed_drop_without_authority_signature() public {
        uint256[4] memory amounts = [uint256(100),1,10,100];
        bytes32[4] memory leaves;
        for (uint256 i; i<4; i++) leaves[i]=keccak256(abi.encodePacked(address(uint160(0x100+i)),i,amounts[i]));
        bytes32 left = pair(leaves[0],leaves[1]); bytes32 right = pair(leaves[2],leaves[3]);
        uint256 id = _create(RewardEngine.ClaimMode.Merkle,0,pair(left,right),"");
        depositKinds(id);
        for (uint256 i; i<4; i++) {
            bytes32[] memory proof = new bytes32[](2);
            proof[0]=leaves[i^1]; proof[1]=i<2?right:left;
            address who=address(uint160(0x100+i));
            vm.prank(who); engine.claimByMerkle(id,proof,who,i,amounts[i]);
        }
        assertEq(token.balanceOf(address(0x100)),100);
        assertEq(nft.ownerOf(701),address(0x101));
        assertEq(multi.balanceOf(address(0x102),55),10);
        assertEq(address(0x103).balance,100);
    }

    function pair(bytes32 a, bytes32 b) internal pure returns(bytes32) {
        return a<b ? keccak256(abi.encodePacked(a,b)) : keccak256(abi.encodePacked(b,a));
    }

    function test_feature_partial_auto_settlement_leaves_creator_expiry_reclaim() public {
        uint256 id = _create(RewardEngine.ClaimMode.Auto,0,0,""); depositKinds(id);
        address[] memory winners=new address[](1);winners[0]=alice;
        uint256[] memory indices=new uint256[](1);
        bytes memory signature=_sig(_ethSigned(keccak256(abi.encodePacked("ORBIX_REWARD_AUTOPUSH_V1",
            address(engine),block.chainid,id,keccak256(abi.encode(winners,indices))))));
        vm.prank(alice);engine.autoPush(id,winners,indices,signature);
        vm.warp(block.timestamp+8 days);vm.prank(creator);engine.reclaimExpired(id);
        assertEq(token.balanceOf(alice),100);assertEq(nft.ownerOf(701),creator);
        assertEq(multi.balanceOf(creator,55),10);assertEq(creator.balance,100);
    }

    function test_feature_replenish_and_allocate_after_partial_code_claim() public {
        uint256 id=_create(RewardEngine.ClaimMode.Code,0,0,"");
        vm.prank(creator);engine.depositERC20(id,address(token),100);
        vm.prank(creator);engine.setAllocation(id,alice,0,25);
        bytes memory signature=codeSignature(id,0,alice);vm.prank(alice);engine.claimByCode(id,0,1,signature);
        vm.prank(creator);engine.setAllocation(id,bob,0,75);
        vm.prank(creator);engine.depositERC20(id,address(token),30);
        vm.prank(creator);engine.setAllocation(id,alice,1,30);
        signature=codeSignature(id,1,bob);vm.prank(bob);engine.claimByCode(id,1,2,signature);
        signature=codeSignature(id,2,alice);vm.prank(alice);engine.claimByCode(id,2,3,signature);
        assertEq(token.balanceOf(alice),55);assertEq(token.balanceOf(bob),75);
    }

    function test_feature_claim_at_deadline_and_reclaim_strictly_after() public {
        uint256 id=_create(RewardEngine.ClaimMode.Code,0,0,"");
        vm.prank(creator);engine.depositERC20(id,address(token),100);
        (,,,uint64 deadline,,,,)=engine.poolInfo(id);
        vm.warp(deadline);
        vm.prank(creator);engine.setAllocation(id,alice,0,40);
        bytes memory signature=codeSignature(id,0,alice);vm.prank(alice);engine.claimByCode(id,0,1,signature);
        vm.prank(creator);vm.expectRevert(RewardEngine.NotExpired.selector);engine.reclaimExpired(id);
        vm.warp(deadline+1);vm.prank(creator);engine.reclaimExpired(id);
        assertEq(token.balanceOf(alice),40);assertEq(token.balanceOf(address(engine)),0);
    }

    function test_feature_safe_nft_receiver_may_forward_prize_during_receipt() public {
        ForwardRewardNFT receiver=new ForwardRewardNFT(bob);
        uint256 id=_create(RewardEngine.ClaimMode.Auto,0,0,"");
        nft.mint(creator,7);vm.prank(creator);nft.approve(address(engine),7);
        vm.prank(creator);engine.depositERC721(id,address(nft),7);
        address[] memory winners=new address[](1);winners[0]=address(receiver);
        uint256[] memory indices=new uint256[](1);
        bytes memory signature=_sig(_ethSigned(keccak256(abi.encodePacked("ORBIX_REWARD_AUTOPUSH_V1",
            address(engine),block.chainid,id,keccak256(abi.encode(winners,indices))))));
        engine.autoPush(id,winners,indices,signature);assertEq(nft.ownerOf(7),bob);
    }

    function test_authority_has_no_allocation_or_reclaim_privileges() public {
        uint256 id=_create(RewardEngine.ClaimMode.Code,0,0,"");
        vm.prank(creator);engine.depositERC20(id,address(token),100);
        vm.prank(authority);vm.expectRevert(RewardEngine.NotCreator.selector);engine.setAllocation(id,alice,0,100);
        vm.warp(block.timestamp+8 days);
        vm.prank(authority);vm.expectRevert(RewardEngine.NotCreator.selector);engine.reclaimExpired(id);
        assertEq(engine.safetyVersion(),2);
    }

    function test_noop_nft_cannot_consume_code_allocation() public {
        NoOutgoingNFT broken=new NoOutgoingNFT();broken.mint(creator,7);
        uint256 id=_create(RewardEngine.ClaimMode.Code,0,0,"");
        vm.prank(creator);broken.approve(address(engine),7);
        vm.prank(creator);engine.depositERC721(id,address(broken),7);
        vm.prank(creator);engine.setAllocation(id,alice,0,1);broken.setBlockOutgoing();
        bytes memory signature=codeSignature(id,0,alice);
        vm.prank(alice);vm.expectRevert(RewardEngine.TransferMismatch.selector);engine.claimByCode(id,0,1,signature);
        (,,,bool claimed)=engine.allocationInfo(id,0);
        assertFalse(claimed);assertEq(engine.reserved(id,0),1);assertEq(broken.ownerOf(7),address(engine));
    }

    function test_dynamic_outgoing_fee_rolls_back_claim_and_creator_reclaim() public {
        DynamicRewardFee taxed=new DynamicRewardFee();taxed.mint(creator,100);
        uint256 id=_create(RewardEngine.ClaimMode.Code,0,0,"");
        vm.prank(creator);taxed.approve(address(engine),100);vm.prank(creator);engine.depositERC20(id,address(taxed),100);
        vm.prank(creator);engine.setAllocation(id,alice,0,100);taxed.enableFee();
        bytes memory signature=codeSignature(id,0,alice);
        vm.prank(alice);vm.expectRevert(RewardEngine.TransferMismatch.selector);engine.claimByCode(id,0,1,signature);
        (,,,bool claimed)=engine.allocationInfo(id,0);assertFalse(claimed);assertEq(engine.reserved(id,0),100);
        vm.warp(block.timestamp+8 days);vm.prank(creator);vm.expectRevert(RewardEngine.TransferMismatch.selector);engine.reclaimExpired(id);
        assertEq(taxed.balanceOf(address(engine)),100);(,,,,uint8 state,,,)=engine.poolInfo(id);assertEq(state,0);
    }

    function test_feature_receiver_can_burn_its_nft_during_delivery() public {
        BurnableRewardNFT burnable=new BurnableRewardNFT();BurnRewardOnReceipt receiver=new BurnRewardOnReceipt();
        uint256 id=_create(RewardEngine.ClaimMode.Auto,0,0,"");burnable.mint(creator,7);
        vm.prank(creator);burnable.approve(address(engine),7);vm.prank(creator);engine.depositERC721(id,address(burnable),7);
        address[] memory winners=new address[](1);winners[0]=address(receiver);uint256[] memory indices=new uint256[](1);
        bytes memory signature=_sig(_ethSigned(keccak256(abi.encodePacked("ORBIX_REWARD_AUTOPUSH_V1",
            address(engine),block.chainid,id,keccak256(abi.encode(winners,indices))))));
        engine.autoPush(id,winners,indices,signature);
        (,,,uint256[] memory amounts)=engine.poolAssets(id);assertEq(amounts[0],0);
        vm.expectRevert();burnable.ownerOf(7);
    }
}
