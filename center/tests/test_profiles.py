"""Profile system tests: CRUD, validation, privacy toggle, batch lookup."""
import pytest
from fastapi.testclient import TestClient

import center.api as api_mod


def _client(tmp_path):
    app = api_mod.create_app(db_path=str(tmp_path / "p.db"))
    return TestClient(app)


def _sign_in(client, key_hex="0x" + "aa" * 32):
    from eth_account import Account
    acct = Account.from_key(key_hex)
    nonce = client.post(f"{api_mod.API_PREFIX}/auth/nonce", json={"address": acct.address}).json()["nonce"]
    sig = Account.sign_message(
        api_mod.encode_defunct(text=f"Orbix Center sign-in\nnonce: {nonce}"), private_key=acct.key
    ).signature.hex()
    tok = client.post(f"{api_mod.API_PREFIX}/auth/verify",
                      json={"address": acct.address, "nonce": nonce, "signature": sig}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}, acct.address.lower()




def test_set_and_get_profile(tmp_path):
    client = _client(tmp_path)
    headers, addr = _sign_in(client)
    r = client.post(f"{api_mod.API_PREFIX}/profile", headers=headers,
                    json={"name": "Alice", "bio": "I play games", "hue": 200, "showAddress": True})
    assert r.status_code == 200
    assert r.json()["name"] == "Alice"
    # fetch public profile
    r2 = client.get(f"{api_mod.API_PREFIX}/profile/{addr}")
    assert r2.status_code == 200
    p = r2.json()
    assert p["name"] == "Alice"
    assert p["showAddress"] is True
    assert "address" in p  # address IS shown


def test_private_profile_hides_address(tmp_path):
    client = _client(tmp_path)
    headers, addr = _sign_in(client)
    r = client.post(f"{api_mod.API_PREFIX}/profile", headers=headers,
                    json={"name": "Secret", "bio": "", "hue": 100, "showAddress": False})
    assert r.status_code == 200
    # fetch public profile — address should NOT be in the response
    r2 = client.get(f"{api_mod.API_PREFIX}/profile/{addr}")
    p = r2.json()
    assert p["showAddress"] is False
    assert "address" not in p  # address NOT shown


def test_name_too_short_rejected(tmp_path):
    client = _client(tmp_path)
    headers, _ = _sign_in(client)
    r = client.post(f"{api_mod.API_PREFIX}/profile", headers=headers, json={"name": "A"})
    assert r.status_code == 422


def test_name_too_long_rejected(tmp_path):
    client = _client(tmp_path)
    headers, _ = _sign_in(client)
    r = client.post(f"{api_mod.API_PREFIX}/profile", headers=headers, json={"name": "X" * 25})
    assert r.status_code == 422


def test_bio_too_long_rejected(tmp_path):
    client = _client(tmp_path)
    headers, _ = _sign_in(client)
    r = client.post(f"{api_mod.API_PREFIX}/profile", headers=headers,
                    json={"name": "Valid", "bio": "X" * 201})
    assert r.status_code == 422


def test_unauthenticated_set_profile_rejected(tmp_path):
    client = _client(tmp_path)
    r = client.post(f"{api_mod.API_PREFIX}/profile", json={"name": "Hacker"})
    assert r.status_code == 401


def test_get_nonexistent_profile_returns_defaults(tmp_path):
    client = _client(tmp_path)
    r = client.get(f"{api_mod.API_PREFIX}/profile/0x{'ef' * 20}")
    assert r.status_code == 200
    assert r.json()["name"] == ""


def test_batch_profiles(tmp_path):
    client = _client(tmp_path)
    h1, a1 = _sign_in(client, "0x" + "11" * 32)
    h2, a2 = _sign_in(client, "0x" + "22" * 32)
    client.post(f"{api_mod.API_PREFIX}/profile", headers=h1,
                json={"name": "User1", "bio": "", "hue": 10, "showAddress": True})
    r = client.post(f"{api_mod.API_PREFIX}/profiles/batch", json={"addresses": [a1, a2]})
    assert r.status_code == 200
    p = r.json()
    assert p.get(a1, {}).get("name") == "User1"
    assert a2 not in p or p[a2].get("name") == ""
