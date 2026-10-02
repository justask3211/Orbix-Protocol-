// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20, MockERC721, MockERC1155} from "../../src/center/mocks/Mocks.sol";
import {CenterRegistry} from "../../src/center/CenterRegistry.sol";
import {CenterVault} from "../../src/center/CenterVault.sol";
import {CenterEscrow} from "../../src/center/CenterEscrow.sol";
import {SettlementVerifier} from "../../src/center/SettlementVerifier.sol";
import {ICenterRegistry, ISettlementVerifier} from "../../src/center/ICenter.sol";

/// @notice Local/preview deployment of the Center stack against a throwaway chain.
/// Writes every address to JSON so the Python runner never guesses one.
contract DeployCenter is Script {
    /// One memory struct keeps the serializer's stack shallow.
    struct Deployment {
        uint256 chainId;
        address token;
        address nft;
        address multi;
        address registry;
        address vault;
        address escrow;
        address verifier;
        address authority;
        address creator;
        address playerA;
        address playerB;
    }

    function run() external {
        // Anvil account 0 owns the platform, account 1 is the settlement authority.
        uint256 ownerKey =
            vm.envOr("CENTER_OWNER_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address authority = vm.envOr("CENTER_AUTHORITY", address(0x70997970C51812dc3A010C7d01b50e0d17dc79C8));
        address playerA = vm.envOr("CENTER_PLAYER_A", address(0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC));
        address playerB = vm.envOr("CENTER_PLAYER_B", address(0x90F79bf6EB2c4f870365E785982E1f101E93b906));

        vm.startBroadcast(ownerKey);

        MockERC20 token = new MockERC20("Orbix Test Token", "OBX-T", 18);
        MockERC721 nft = new MockERC721();
        MockERC1155 multi = new MockERC1155();

        SettlementVerifier verifier = new SettlementVerifier();
        CenterRegistry registry = new CenterRegistry();
        CenterVault vault = new CenterVault(IERC20(address(token)));
        CenterEscrow escrow =
            new CenterEscrow(ICenterRegistry(address(registry)), ISettlementVerifier(address(verifier)));

        // Registry: only this escrow, this token and the release-one templates are allowed.
        registry.setEscrow(address(escrow), true);
        registry.setAsset(address(token), true);
        registry.setTemplate(keccak256("number-hunt"), true);
        registry.setTemplate(keccak256("live-quiz"), true);
        registry.setTemplate(keccak256("memory-match"), true);
        registry.setTemplate(keccak256("token-catch"), true);
        registry.setTemplate(keccak256("reaction-duel"), true);
        registry.setTemplate(keccak256("puzzle-sprint"), true);
        registry.setTemplate(keccak256("hash-hunt"), true);
        registry.setTemplate(keccak256("boss-raid"), true);
        registry.setFeeRecipient(vm.addr(ownerKey));

        // Epoch 1 is the live settlement authority for this preview deployment.
        verifier.setEpochSigner(1, authority);

        token.mint(vm.addr(ownerKey), 1_000_000 ether);
        token.mint(playerA, 1_000_000 ether);
        token.mint(playerB, 1_000_000 ether);
        nft.mint(address(escrow), 1);
        multi.mint(address(escrow), 7, 1000);

        vm.stopBroadcast();

        Deployment memory d;
        d.chainId = block.chainid;
        d.token = address(token);
        d.nft = address(nft);
        d.multi = address(multi);
        d.registry = address(registry);
        d.vault = address(vault);
        d.escrow = address(escrow);
        d.verifier = address(verifier);
        d.authority = authority;
        d.creator = vm.addr(ownerKey);
        d.playerA = playerA;
        d.playerB = playerB;

        _write(d);
    }

    function _write(Deployment memory d) private {
        string memory obj = "center";
        vm.serializeUint(obj, "chainId", d.chainId);
        vm.serializeAddress(obj, "token", d.token);
        vm.serializeAddress(obj, "nft", d.nft);
        vm.serializeAddress(obj, "multi", d.multi);
        vm.serializeAddress(obj, "registry", d.registry);
        vm.serializeAddress(obj, "vault", d.vault);
        vm.serializeAddress(obj, "escrow", d.escrow);
        vm.serializeAddress(obj, "verifier", d.verifier);
        vm.serializeAddress(obj, "authority", d.authority);
        vm.serializeAddress(obj, "creator", d.creator);
        vm.serializeAddress(obj, "playerA", d.playerA);
        vm.serializeAddress(obj, "playerB", d.playerB);
        string memory json = vm.serializeString(obj, "network", "local-anvil");

        string memory path = vm.envOr("CENTER_DEPLOY_OUT", string("center/deployments/local.json"));
        vm.writeJson(json, path);
    }
}
