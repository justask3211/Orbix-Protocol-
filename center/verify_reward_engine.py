"""Read-only v2 release verification. Never signs, funds or submits transactions."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from eth_abi import decode
from eth_utils import keccak

from center.entry_gate import _address, _hex_bytes, _quantity
from center.reward_flow import call_data
from center.vault import JsonRpc


def expected_runtime(artifact: dict, authority: str, root: Path) -> bytes:
    metadata = artifact['metadata']
    if isinstance(metadata, str):
        metadata = json.loads(metadata)
    settings = metadata['settings']
    if (metadata['compiler']['version'] != '0.8.37+commit.f401782d' or settings['evmVersion'] != 'cancun'
            or settings['optimizer'] != {'enabled': True, 'runs': 200} or not settings['viaIR']):
        raise ValueError('Build with FOUNDRY_PROFILE=rewards_v2 before verification.')
    for name, source in metadata['sources'].items():
        if '0x' + keccak((root / name).read_bytes()).hex() != source['keccak256']:
            raise ValueError('Artifact sources differ from this checkout; rebuild before verification.')
    compiled = artifact['deployedBytecode']
    refs = compiled['immutableReferences']
    if len(refs) != 1 or compiled['linkReferences']:
        raise ValueError('Unexpected immutable or library layout; review the artifact.')
    runtime = bytearray.fromhex(compiled['object'].removeprefix('0x'))
    word = bytes.fromhex(authority.removeprefix('0x')).rjust(32, b'\0')
    for locations in refs.values():
        for ref in locations:
            if ref['length'] != 32 or ref['start'] + 32 > len(runtime):
                raise ValueError('Unexpected immutable reference.')
            runtime[ref['start']:ref['start']+32] = word
    return bytes(runtime)


def verify(rpc, engine: str, authority: str, runtime: bytes) -> dict:
    engine, authority = _address(engine, 'engine'), _address(authority, 'authority')
    if _quantity(rpc.call('eth_chainId', [])) != 46630:
        raise ValueError('Expected chain 46630.')
    head = _quantity(rpc.call('eth_blockNumber', []))
    if head < 2:
        raise ValueError('Wait for at least three confirmations.')
    block = hex(head - 2)
    code = _hex_bytes(rpc.call('eth_getCode', [engine, block]))
    if not runtime or code != runtime:
        raise ValueError('Deployed bytecode differs from the reviewed artifact and authority.')

    def read(signature, inputs, values, outputs):
        raw = rpc.call('eth_call', [{'to':engine, 'data':call_data(signature, inputs, values)}, block])
        return decode(outputs, _hex_bytes(raw))

    if read('authority()', [], [], ['address'])[0].lower() != authority:
        raise ValueError('Authority mismatch.')
    if read('safetyVersion()', [], [], ['uint256'])[0] != 2:
        raise ValueError('Expected safetyVersion == 2.')
    if read('poolCount()', [], [], ['uint256'])[0] != 0:
        raise ValueError('Fresh replacement engine must have zero pools before cutover.')
    info = read('poolInfo(uint256)', ['uint256'], [0], ['address','bytes32','uint8','uint64','uint8','uint256','bytes32','string'])
    assets = read('poolAssets(uint256)', ['uint256'], [0], ['uint8[]','address[]','uint256[]','uint256[]'])
    ids = read('roomPoolIds(bytes32)', ['bytes32'], [b'\0'*32], ['uint256[]'])[0]
    if int(info[0], 16) != 0 or any(assets) or ids or read('isClaimed(uint256,address)', ['uint256','address'], [0,authority], ['bool'])[0]:
        raise ValueError('Fresh engine read ABI returned unexpected inventory.')
    return {'engine':engine,'authority':authority,'chainId':46630,'safetyVersion':2,'poolCount':0,
            'verifiedBlock':int(block,16),'runtimeKeccak':'0x'+keccak(code).hex(),'readABI':'verified'}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine', required=True)
    parser.add_argument('--authority', required=True)
    parser.add_argument('--rpc-url', default=os.environ.get('CENTER_RPC_URL','https://rpc.testnet.chain.robinhood.com'))
    parser.add_argument('--artifact', default='out/RewardEngine.sol/RewardEngine.json')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    try:
        authority = _address(args.authority, 'authority')
        artifact = json.loads(Path(args.artifact).read_text())
        runtime = expected_runtime(artifact, authority, root)
        result = verify(JsonRpc(args.rpc_url, 46630), args.engine, authority, runtime)
    except Exception as exc:
        # RPC errors may contain provider credentials; keep CLI errors generic.
        raise SystemExit('Verification failed. Check chain, confirmations, addresses and release artifact; funding must remain off.') from exc
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
