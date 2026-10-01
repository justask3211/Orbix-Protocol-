"""API tests for the read-only token identity endpoint (P1 trust primitive)."""

import pytest
from fastapi.testclient import TestClient

import center.api as api_mod


TOKEN = "0x" + "16" * 20


def _client(monkeypatch, fake_rpc) -> TestClient:
    """Build the app with a stubbed JsonRpc so no live chain is needed."""
    import os
    for var in ("CENTER_REAL_BURN", "CENTER_VAULT_TOKEN", "CENTER_VAULT_ADDRESS",
                "CENTER_TESTNET_REWARDS", "CENTER_SIGNER_KEY"):
        monkeypatch.delenv(var, raising=False)
    import center.token_identity as ti

    real_inspect = ti.TokenInspector.inspect

    def inspect(self, address):
        self.rpc = fake_rpc  # injected
        return real_inspect(self, address)

    monkeypatch.setattr(ti.TokenInspector, "inspect", inspect)
    import tempfile
    app = api_mod.create_app(db_path=tempfile.mktemp(suffix=".db"))
    return TestClient(app)


def test_token_identity_endpoint_verdict(monkeypatch):
    from center.vault import ChainError

    class FakeRpc:
        chain_id = 46630

        def call(self, method, params):
            if method == "eth_getCode":
                return "0x" + "6080" + "ab" * 40
            data = params[0]["data"].removeprefix("0x")
            if data.startswith("95d89b41"):
                return "0x" + (0x20).to_bytes(32, "big").hex() + (5).to_bytes(32, "big").hex() + b"ORBIX".hex() + "00" * 27
            if data.startswith("313ce567"):
                return "0x" + hex(18)[2:].zfill(64)
            if data.startswith("06fdde03"):
                return "0x" + (0x20).to_bytes(32, "big").hex() + (9).to_bytes(32, "big").hex() + b"OrbixFree".hex() + "00" * 23
            raise ChainError("x")

    client = _client(monkeypatch, FakeRpc())
    r = client.get(f"{api_mod.API_PREFIX}/token/{TOKEN}")
    assert r.status_code == 200
    body = r.json()
    assert body["entry_ok"] is True
    assert body["facts"]["symbol"] == "ORBIX"
    assert body["facts"]["decimals"] == 18


def test_token_identity_rejects_bad_address(monkeypatch):
    client = _client(monkeypatch, None)
    r = client.get(f"{api_mod.API_PREFIX}/token/not-an-address")
    assert r.status_code == 422
