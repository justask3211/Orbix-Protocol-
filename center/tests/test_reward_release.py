"""Bytecode attestation must reject spoofed markers and wrong immutable signers."""
from eth_abi import encode
from eth_utils import keccak
import pytest
from center.verify_reward_engine import expected_runtime, verify
from center.reward_flow import call_data

AUTH='0x'+'11'*20
ENGINE='0x'+'22'*20
RUNTIME=b'\x60\x00'

class Rpc:
    chain='0xb626'
    code='0x'+RUNTIME.hex()
    authority=AUTH
    version=2
    pools=0
    def call(self, method, params):
        if method=='eth_chainId': return self.chain
        if method=='eth_blockNumber': return '0x100'
        if method=='eth_getCode': return self.code
        assert params[1]=='0xfe'
        data=params[0]['data']
        reads={
            call_data('authority()'): (['address'],[self.authority]),
            call_data('safetyVersion()'): (['uint256'],[self.version]),
            call_data('poolCount()'): (['uint256'],[self.pools]),
            call_data('poolInfo(uint256)',['uint256'],[0]): (['address','bytes32','uint8','uint64','uint8','uint256','bytes32','string'],['0x'+'00'*20,b'\0'*32,0,0,0,0,b'\0'*32,'']),
            call_data('poolAssets(uint256)',['uint256'],[0]): (['uint8[]','address[]','uint256[]','uint256[]'],[[],[],[],[]]),
            call_data('roomPoolIds(bytes32)',['bytes32'],[b'\0'*32]): (['uint256[]'],[[]]),
            call_data('isClaimed(uint256,address)',['uint256','address'],[0,AUTH]): (['bool'],[False]),
        }
        types,values=reads[data]
        return '0x'+encode(types,values).hex()


def test_confirmed_release_reads_share_one_block_and_empty_inventory():
    report=verify(Rpc(),ENGINE,AUTH,RUNTIME)
    assert report['verifiedBlock']==254 and report['readABI']=='verified'


@pytest.mark.parametrize('field,value', [('chain','0x1'),('code','0x6001'),('authority',ENGINE),('version',1),('pools',1)])
def test_failed_release_gate_never_accepts_wrong_code_signer_chain_or_existing_pools(field,value):
    rpc=Rpc();setattr(rpc,field,value)
    with pytest.raises(ValueError):verify(rpc,ENGINE,AUTH,RUNTIME)


def test_artifact_immutable_substitution_and_changed_source_fail_closed(tmp_path):
    source=tmp_path/'RewardEngine.sol';source.write_text('reviewed source')
    artifact={'metadata':{'compiler':{'version':'0.8.37+commit.f401782d'},'settings':{'evmVersion':'cancun','optimizer':{'enabled':True,'runs':200},'viaIR':True},'sources':{'RewardEngine.sol':{'keccak256':'0x'+keccak(source.read_bytes()).hex()}}},
              'deployedBytecode':{'object':'0x6000'+'00'*32,'immutableReferences':{'1':[{'start':2,'length':32}]},'linkReferences':{}}}
    assert expected_runtime(artifact,AUTH,tmp_path)==RUNTIME+bytes.fromhex(AUTH[2:]).rjust(32,b'\0')
    source.write_text('changed source')
    with pytest.raises(ValueError,match='sources differ'):expected_runtime(artifact,AUTH,tmp_path)
