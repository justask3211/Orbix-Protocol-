"""E5 addendum: tamper-evident audit hash chain."""

import sqlite3

import pytest

from center.store import Store


def test_audit_chain_links_every_entry():
    store = Store(":memory:")
    store.append_audit("0xaaa", "pricing.update", {"fee": 1}, {"fee": 2}, 46630)
    store.append_audit("0xaaa", "pricing.update", {"fee": 2}, {"fee": 3}, 46630)
    store.append_audit("0xaaa", "pricing.update", {"fee": 3}, {"fee": 4}, 46630)
    result = store.verify_audit_chain()
    assert result["ok"] is True
    assert result["entries"] == 3


def test_each_entry_commits_to_its_predecessor():
    store = Store(":memory:")
    store.append_audit("0xaaa", "a", {}, {"x": 1}, 46630)
    first = store.list_audit()[0]
    store.append_audit("0xaaa", "a", {"x": 1}, {"x": 2}, 46630)
    second = store.list_audit()[0]  # newest first
    assert second["prevHash"] == first["entryHash"]


def test_history_edit_breaks_the_chain():
    store = Store(":memory:")
    store.append_audit("0xaaa", "a", {}, {"x": 1}, 46630)
    store.append_audit("0xaaa", "a", {"x": 1}, {"x": 2}, 46630)
    # simulate a silent history edit straight in the DB
    conn = sqlite3.connect(store.path if store.path != ":memory:" else ":memory:")
    # :memory: store can't be reopened; do the edit through a second cursor on the live conn
    store._conn.execute("UPDATE admin_audit SET new_json = '{\"x\": 999}' WHERE id = 1")
    store._conn.commit()
    result = store.verify_audit_chain()
    assert result["ok"] is False
    assert result["brokenAt"] == 1


def test_row_deletion_breaks_the_chain():
    store = Store(":memory:")
    store.append_audit("0xaaa", "a", {}, {"x": 1}, 46630)
    store.append_audit("0xaaa", "a", {"x": 1}, {"x": 2}, 46630)
    store._conn.execute("DELETE FROM admin_audit WHERE id = 1")
    store._conn.commit()
    result = store.verify_audit_chain()
    assert result["ok"] is False


def test_api_audit_verify_endpoint(monkeypatch, tmp_path):
    import center.api as api_mod
    from fastapi.testclient import TestClient

    for var in ("CENTER_REAL_BURN", "CENTER_VAULT_TOKEN", "CENTER_VAULT_ADDRESS",
                "CENTER_TESTNET_REWARDS", "CENTER_SIGNER_KEY"):
        monkeypatch.delenv(var, raising=False)
    app = api_mod.create_app(db_path=str(tmp_path / "c.db"))
    client = TestClient(app)
    r = client.get(f"{api_mod.API_PREFIX}/admin/audit/verify")
    assert r.status_code == 401  # unauthenticated is refused
