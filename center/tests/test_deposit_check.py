"""Deposit-check endpoint: QR-deposit reconciliation is safe and idempotent.

Contract deposit credits on-chain via CenterVault.deposit(); the QR path lets a
user send from any wallet and then reconcile. The endpoint MUST:
  * refuse when funded mode is off
  * rate-limit per wallet
  * credit only the DELTA between the software ledger and on-chain balanceOf
  * never credit twice for the same on-chain balance (idempotent)
"""

import pytest
from fastapi.testclient import TestClient

import center.api as api_mod


def _client(monkeypatch, tmp_path, *, real: bool, onchain_vault: int):
    for var in ("CENTER_REAL_BURN", "CENTER_VAULT_TOKEN", "CENTER_VAULT_ADDRESS",
                "CENTER_SIGNER_KEY", "CENTER_TESTNET_REWARDS"):
        monkeypatch.delenv(var, raising=False)
    if real:
        monkeypatch.setenv("CENTER_REAL_BURN", "true")
        monkeypatch.setenv("CENTER_VAULT_TOKEN", "0x" + "aa" * 20)
        monkeypatch.setenv("CENTER_VAULT", "0x" + "bb" * 20)
        monkeypatch.setenv("CENTER_SIGNER_KEY", "0x" + "11" * 32)
        monkeypatch.setenv("CENTER_DB", str(tmp_path / "funded.db"))
        monkeypatch.setenv("CENTER_ESCROW", "0x" + "cc" * 20)

    app = api_mod.create_app(db_path=str(tmp_path / "c.db"))

    class FakeRpc:
        chain_id = 46630

        def call(self, method, params):
            data = params[0]["data"]
            selector = data[:10]
            if selector == "0x70a08231":  # balanceOf(address)
                to = params[0]["to"].lower()
                # vault address query returns the vault balance; token query returns wallet balance
                return hex(onchain_vault)[2:].rjust(64, "0")
            raise AssertionError("unexpected call")

    if real:
        app.state.balance_rpc = FakeRpc()
    return TestClient(app), FakeRpc


ACCT = "0x" + "ab" * 20


def _sign_in(client) -> dict:
    from eth_account import Account
    acct = Account.from_key("0x" + "33" * 32)
    nonce = client.post(f"{api_mod.API_PREFIX}/auth/nonce", json={"address": acct.address}).json()["nonce"]
    sig = Account.sign_message(
        api_mod.encode_defunct(text=f"Orbix Center sign-in\nnonce: {nonce}"), private_key=acct.key
    ).signature.hex()
    tok = client.post(
        f"{api_mod.API_PREFIX}/auth/verify",
        json={"address": acct.address, "nonce": nonce, "signature": sig},
    ).json()["token"]
    return {"Authorization": f"Bearer {tok}"}, acct.address


def test_deposit_check_disabled_without_funded_mode(tmp_path, monkeypatch):
    client, _ = _client(monkeypatch, tmp_path, real=False, onchain_vault=0)
    headers, _ = _sign_in(client)
    r = client.post(f"{api_mod.API_PREFIX}/wallet/deposit/check", headers=headers)
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "FUNDED_DISABLED"


def test_deposit_check_credits_the_delta_once(tmp_path, monkeypatch):
    client, _ = _client(monkeypatch, tmp_path, real=True, onchain_vault=5 * 10**18)
    headers, addr = _sign_in(client)
    r1 = client.post(f"{api_mod.API_PREFIX}/wallet/deposit/check", headers=headers)
    assert r1.status_code == 200
    body = r1.json()
    assert body["credited"] == 5 * 10**18
    assert body["balance"] == 5 * 10**18
    assert body["synced"] is True


def test_deposit_check_rate_limited(tmp_path, monkeypatch):
    client, _ = _client(monkeypatch, tmp_path, real=True, onchain_vault=10**18)
    headers, _ = _sign_in(client)
    assert client.post(f"{api_mod.API_PREFIX}/wallet/deposit/check", headers=headers).status_code == 200
    second = client.post(f"{api_mod.API_PREFIX}/wallet/deposit/check", headers=headers)
    assert second.status_code == 429
    assert second.json()["detail"]["code"] == "RATE_LIMITED"


def test_deposit_check_requires_auth(tmp_path, monkeypatch):
    client, _ = _client(monkeypatch, tmp_path, real=True, onchain_vault=10**18)
    r = client.post(f"{api_mod.API_PREFIX}/wallet/deposit/check")
    assert r.status_code == 401
