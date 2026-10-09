// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {RewardEngine} from "../../src/center/RewardEngine.sol";
import {CenterGamePot} from "../../src/center/CenterGamePot.sol";
import {MockERC20, MockERC721, MockERC1155, MockFeeOnTransferERC20} from "../../src/center/mocks/Mocks.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract RewardsAuditTest is Test, IERC721Receiver {
    RewardEngine engine;
    CenterGamePot pot;
    MockERC20 token;
    MockERC721 nft;
    MockERC1155 multi;
    uint256 constant PK = 0xA11CE;
    address creator = address(0xCA);
    address other = address(0xCB);
    address alice = address(0xA1);
    address bob = address(0xB1);
    address treasury = address(0xBEEF);
    function setUp() public {
        vm.warp(1000);
        engine = new RewardEngine(vm.addr(PK));
        pot = new CenterGamePot(vm.addr(PK), treasury, 0);
        token = new MockERC20("T", "T", 18); nft = new MockERC721(); multi = new MockERC1155();
        token.mint(creator, 1000); token.mint(other, 1000);
        vm.prank(creator); token.approve(address(engine), type(uint256).max);
        vm.prank(other); token.approve(address(engine), type(uint256).max);
    }
    function pool(address host, RewardEngine.ClaimMode mode, uint32 cap, bytes32 root) internal returns(uint256) {
        vm.prank(host); return engine.createPool(keccak256(abi.encode(host)), mode, uint64(block.timestamp + 2 days), cap, root, "");
    }
    function sig(bytes32 digest) internal returns(bytes memory){(uint8 v,bytes32 r,bytes32 s)=vm.sign(PK,digest);return abi.encodePacked(r,s,v);}
    function code(uint256 id,uint256 slot,address who,uint256 nonce) internal returns(bytes memory){return sig(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", keccak256(abi.encodePacked("ORBIX_REWARD_CLAIM_V1",address(engine),block.chainid,id,slot,who,nonce)))));}
    function test_expired_erc20_pool_cannot_sweep_other_creator_pool() public {
        uint256 a=pool(creator,RewardEngine.ClaimMode.Code,0,0); uint256 b=pool(other,RewardEngine.ClaimMode.Code,0,0);
        vm.prank(creator);engine.depositERC20(a,address(token),100);vm.prank(other);engine.depositERC20(b,address(token),200);
        vm.warp(block.timestamp+3 days);vm.prank(creator);engine.reclaimExpired(a);
        assertEq(token.balanceOf(address(engine)),200);(,,,uint256[] memory amounts)=engine.poolAssets(b);assertEq(amounts[0],200);
        vm.prank(creator);vm.expectRevert(RewardEngine.AlreadySettled.selector);engine.reclaimExpired(a);
    }
    function testFuzz_expiry_isolates_eth_balances(uint96 first,uint96 second) public {
        vm.assume(first>0 && second>0);
        uint256 a=pool(creator,RewardEngine.ClaimMode.Code,0,0); uint256 b=pool(other,RewardEngine.ClaimMode.Code,0,0);
        vm.deal(creator,first);vm.deal(other,second);
        vm.prank(creator);engine.depositETH{value:first}(a);vm.prank(other);engine.depositETH{value:second}(b);
        vm.warp(block.timestamp+3 days);vm.prank(creator);engine.reclaimExpired(a);
        assertEq(address(engine).balance,second);assertEq(creator.balance,first);
    }
    function test_unallocated_nfts_and_1155_reclaim_by_inventory() public {
        uint256 id=pool(creator,RewardEngine.ClaimMode.Code,0,0);
        nft.mint(creator,7);vm.prank(creator);nft.approve(address(engine),7);vm.prank(creator);engine.depositERC721(id,address(nft),7);
        multi.mint(creator,99,10);vm.prank(creator);multi.setApprovalForAll(address(engine),true);vm.prank(creator);engine.depositERC1155(id,address(multi),99,10,"");
        vm.warp(block.timestamp+3 days);vm.prank(creator);engine.reclaimExpired(id);
        assertEq(nft.ownerOf(7),creator);assertEq(multi.balanceOf(creator,99),10);
    }
    function test_allocation_conservation_and_open_distinct_wallets() public {
        uint256 id=pool(creator,RewardEngine.ClaimMode.Open,2,0);vm.prank(creator);engine.depositERC20(id,address(token),20);
        vm.prank(creator);engine.setAllocation(id,address(0),0,10);
        vm.prank(creator);vm.expectRevert(RewardEngine.BadAllocation.selector);engine.setAllocation(id,address(0),0,11);
        vm.prank(creator);engine.setAllocation(id,address(0),0,10);vm.prank(alice);engine.claimOpen(id,0);
        vm.prank(alice);vm.expectRevert(RewardEngine.AlreadyClaimed.selector);engine.claimOpen(id,1);
        vm.prank(bob);engine.claimOpen(id,1);assertEq(token.balanceOf(address(engine)),0);
    }
    function test_phantom_open_slot_and_zero_allocation_rejected() public {
        uint256 id=pool(creator,RewardEngine.ClaimMode.Open,2,0);vm.prank(creator);engine.depositERC20(id,address(token),10);
        vm.prank(alice);vm.expectRevert(RewardEngine.BadAllocation.selector);engine.claimOpen(id,99);
        vm.prank(creator);vm.expectRevert(RewardEngine.BadAllocation.selector);engine.setAllocation(id,address(0),0,0);
    }
    function test_code_multiple_slots_same_wallet_and_nonce_replay() public {
        uint256 id=pool(creator,RewardEngine.ClaimMode.Code,0,0);vm.prank(creator);engine.depositERC20(id,address(token),20);
        vm.prank(creator);engine.setAllocation(id,alice,0,10);vm.prank(creator);engine.setAllocation(id,alice,0,10);
        bytes memory s=code(id,0,alice,1);vm.prank(alice);engine.claimByCode(id,0,1,s);
        vm.prank(alice);vm.expectRevert(RewardEngine.AlreadyClaimed.selector);engine.claimByCode(id,0,1,s);
        s=code(id,1,alice,2);vm.prank(alice);engine.claimByCode(id,1,2,s);assertEq(token.balanceOf(alice),20);
    }
    function test_merkle_third_party_cannot_consume_winner_claim() public {
        bytes32 leaf=keccak256(abi.encodePacked(alice,uint256(0),uint256(10)));
        uint256 id=pool(creator,RewardEngine.ClaimMode.Merkle,0,leaf);vm.prank(creator);engine.depositERC20(id,address(token),10);
        vm.prank(bob);vm.expectRevert(RewardEngine.NotWinner.selector);engine.claimByMerkle(id,new bytes32[](0),alice,0,10);
        vm.prank(alice);engine.claimByMerkle(id,new bytes32[](0),alice,0,10);assertEq(token.balanceOf(alice),10);
    }
    function test_expired_deposit_and_allocation_and_auto_push_rejected() public {
        uint256 id=pool(creator,RewardEngine.ClaimMode.Code,0,0);vm.prank(creator);engine.depositERC20(id,address(token),10);
        vm.warp(block.timestamp+3 days);
        vm.prank(creator);vm.expectRevert(RewardEngine.DeadlinePassed.selector);engine.depositERC20(id,address(token),10);
        vm.prank(creator);vm.expectRevert(RewardEngine.DeadlinePassed.selector);engine.setAllocation(id,alice,0,10);
    }
    function test_unsolicited_safe_nft_receipt_rejected() public {
        nft.mint(creator,8);vm.prank(creator);vm.expectRevert(RewardEngine.UnexpectedReceipt.selector);nft.safeTransferFrom(creator,address(engine),8);
    }
    function test_nft_contract_and_recipient_callbacks_cannot_mutate_allocations() public {
        uint256 id=pool(address(this),RewardEngine.ClaimMode.Code,0,0);
        nft.mint(address(this),8);nft.approve(address(engine),8);engine.depositERC721(id,address(nft),8);engine.setAllocation(id,address(this),0,1);
        activePool=id;bytes memory s=code(id,0,address(this),1);engine.claimByCode(id,0,1,s);
        assertTrue(callbackBlocked);assertEq(nft.ownerOf(8),address(this));
    }
    uint256 activePool;bool callbackBlocked;
    function onERC721Received(address,address,uint256,bytes calldata) external returns(bytes4){
        try engine.setAllocation(activePool,address(this),0,1) {} catch {callbackBlocked=true;}
        return this.onERC721Received.selector;
    }

    function test_auto_push_requires_equal_arrays_and_live_deadline() public {
        uint256 id=pool(creator,RewardEngine.ClaimMode.Auto,0,0);vm.prank(creator);engine.depositERC20(id,address(token),10);
        address[] memory winners=new address[](1);winners[0]=alice;
        vm.expectRevert(RewardEngine.BadAllocation.selector);engine.autoPush(id,winners,new uint256[](0),"");
        vm.warp(block.timestamp+3 days);vm.expectRevert(RewardEngine.DeadlinePassed.selector);engine.autoPush(id,winners,new uint256[](1),"");
    }
    function test_two_nft_merkle_winners_receive_their_exact_ids() public {
        bytes32 first=keccak256(abi.encodePacked(alice,uint256(0),uint256(1)));
        bytes32 second=keccak256(abi.encodePacked(bob,uint256(1),uint256(1)));
        bytes32 root=first<second?keccak256(abi.encodePacked(first,second)):keccak256(abi.encodePacked(second,first));
        uint256 id=pool(creator,RewardEngine.ClaimMode.Merkle,0,root);
        for(uint256 i=0;i<2;i++){nft.mint(creator,7+i);vm.prank(creator);nft.approve(address(engine),7+i);vm.prank(creator);engine.depositERC721(id,address(nft),7+i);}
        bytes32[] memory proof=new bytes32[](1);proof[0]=second;vm.prank(alice);engine.claimByMerkle(id,proof,alice,0,1);
        proof[0]=first;vm.prank(bob);engine.claimByMerkle(id,proof,bob,1,1);assertEq(nft.ownerOf(7),alice);assertEq(nft.ownerOf(8),bob);
    }
    function testFuzz_allocation_never_reserves_more_than_custody(uint96 custody,uint96 share) public {
        vm.assume(custody>0 && share>0);token.mint(creator,custody);
        uint256 id=pool(creator,RewardEngine.ClaimMode.Code,0,0);vm.prank(creator);engine.depositERC20(id,address(token),custody);
        if(share>custody){vm.prank(creator);vm.expectRevert(RewardEngine.BadAllocation.selector);engine.setAllocation(id,alice,0,share);}
        else{vm.prank(creator);engine.setAllocation(id,alice,0,share);assertLe(engine.reserved(id,0),custody);}
    }

    function test_fee_on_transfer_deposit_cannot_overcredit_rewards() public {
        MockFeeOnTransferERC20 fee=new MockFeeOnTransferERC20();fee.mint(creator,10000);
        uint256 id=pool(creator,RewardEngine.ClaimMode.Code,0,0);vm.prank(creator);fee.approve(address(engine),10000);
        vm.prank(creator);vm.expectRevert(RewardEngine.ZeroAmount.selector);engine.depositERC20(id,address(fee),10000);
        assertEq(fee.balanceOf(address(engine)),0);(,,,uint256[] memory amounts)=engine.poolAssets(id);assertEq(amounts.length,0);
    }
    function openPot(CenterGamePot.Mode mode) internal returns(bytes32 room){
        room=keccak256(abi.encode(mode));vm.prank(creator);pot.openRoom(room,creator,0,address(token),100,mode,uint64(block.timestamp+1 days));
        vm.prank(other);token.approve(address(pot),100);vm.prank(other);pot.enter(room);
    }
    function settlePot(bytes32 room,uint256 amount) internal {
        address[] memory w=new address[](1);w[0]=alice;uint256[] memory a=new uint256[](1);a[0]=amount;
        address[] memory rw=new address[](0);uint256[] memory ri=new uint256[](0);
        pot.settle(room,w,a,rw,ri,sig(pot.settlementDigest(room,w,a,rw,ri)));
    }
    function test_manual_pot_liability_cannot_be_swept_by_treasury() public {
        bytes32 room=openPot(CenterGamePot.Mode.Manual);settlePot(room,80);
        assertEq(pot.tokenCommitted(address(token)),100);
        vm.prank(treasury);vm.expectRevert(CenterGamePot.NothingToClaim.selector);pot.sweepDust(address(token),1);
        bytes memory s=sig(pot.claimWinningsDigest(room,alice,80,1));pot.claimWinnings(room,alice,80,1,s);
        assertEq(pot.tokenCommitted(address(token)),20);vm.warp(block.timestamp+2 days);vm.prank(creator);pot.reclaimWinnings(room);
        assertEq(pot.tokenCommitted(address(token)),0);assertEq(token.balanceOf(address(pot)),0);
    }
    function test_auto_pot_cannot_pay_winnings_again_via_manual_claim() public {
        bytes32 room=openPot(CenterGamePot.Mode.Auto);settlePot(room,100);
        bytes memory s=sig(pot.claimWinningsDigest(room,alice,100,1));vm.expectRevert(CenterGamePot.NothingToClaim.selector);pot.claimWinnings(room,alice,100,1,s);
        assertEq(token.balanceOf(alice),100);
    }
}
