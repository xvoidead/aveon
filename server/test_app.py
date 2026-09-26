"""Тесты API:  pip install pytest httpx  →  python -m pytest test_app.py"""
import os
import sys
import tempfile
from pathlib import Path

os.environ["AVEON_DB"] = str(Path(tempfile.mkdtemp()) / "test.db")
sys.path.insert(0, str(Path(__file__).parent))

import pytest
from fastapi.testclient import TestClient

from aveon_api import app as server


@pytest.fixture()
def client():
    server.limiter.fails.clear()
    with TestClient(server.app) as c:
        yield c


_n = 0


def register(c, password="password123"):
    global _n
    _n += 1
    r = c.post("/api/auth/register", json={"login": f"user{_n}", "password": password, "device": "pc"})
    assert r.status_code == 200, r.text
    return r.json()["token"], f"user{_n}"


def h(token):
    return {"Authorization": f"Bearer {token}"}


def test_register_login_me(client):
    token, login = register(client)
    r = client.get("/api/me", headers=h(token))
    assert r.json()["user"]["login"] == login
    assert r.json()["sessions"][0]["current"] is True

    r = client.post("/api/auth/login", json={"login": login.upper(), "password": "password123"})
    assert r.status_code == 200
    assert r.json()["token"] != token


def test_register_validation(client):
    assert client.post("/api/auth/register", json={"login": "ab", "password": "password123"}).status_code == 400
    assert client.post("/api/auth/register", json={"login": "abc", "password": "short"}).status_code == 400
    token, login = register(client)
    r = client.post("/api/auth/register", json={"login": login, "password": "password123"})
    assert r.status_code == 409
    assert "error" in r.json()


def test_bad_password_and_rate_limit(client):
    _, login = register(client)
    for _ in range(10):
        assert client.post("/api/auth/login", json={"login": login, "password": "wrong-pass"}).status_code == 401
    assert client.post("/api/auth/login", json={"login": login, "password": "password123"}).status_code == 429


def test_auth_required(client):
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me", headers=h("nope")).status_code == 401


def test_logout(client):
    token, _ = register(client)
    assert client.post("/api/auth/logout", headers=h(token)).status_code == 200
    assert client.get("/api/me", headers=h(token)).status_code == 401


def test_password_change_kills_other_sessions(client):
    t1, login = register(client)
    t2 = client.post("/api/auth/login", json={"login": login, "password": "password123"}).json()["token"]
    r = client.post("/api/me/password", headers=h(t1), json={"old": "password123", "new": "newpassword1"})
    assert r.status_code == 200
    assert client.get("/api/me", headers=h(t1)).status_code == 200
    assert client.get("/api/me", headers=h(t2)).status_code == 401
    assert client.post("/api/auth/login", json={"login": login, "password": "newpassword1"}).status_code == 200


def test_sync_revisions(client):
    token, _ = register(client)
    assert client.get("/api/sync", headers=h(token)).json() == {"docs": []}

    r = client.put("/api/sync/albums/main", headers=h(token), json={"data": {"albums": []}, "base_rev": None})
    assert r.json() == {"rev": 1}
    r = client.put("/api/sync/albums/main", headers=h(token), json={"data": {"albums": [1]}, "base_rev": 1})
    assert r.json() == {"rev": 2}

    # второе устройство пишет со старой ревизией — конфликт и текущие данные сервера
    r = client.put("/api/sync/albums/main", headers=h(token), json={"data": {"albums": [9]}, "base_rev": 1})
    assert r.status_code == 409
    assert r.json()["rev"] == 2 and r.json()["data"] == {"albums": [1]}

    docs = client.get("/api/sync", headers=h(token)).json()["docs"]
    assert docs[0]["kind"] == "albums" and docs[0]["data"] == {"albums": [1]}

    assert client.put("/api/sync/nope/main", headers=h(token), json={"data": 1}).status_code == 404
    assert client.put("/api/sync/stats/bad key", headers=h(token), json={"data": 1}).status_code == 404


def test_users_isolated(client):
    t1, _ = register(client)
    t2, _ = register(client)
    client.put("/api/sync/settings/main", headers=h(t1), json={"data": {"a": 1}})
    assert client.get("/api/sync", headers=h(t2)).json() == {"docs": []}


def test_delete_account(client):
    token, login = register(client)
    client.put("/api/sync/settings/main", headers=h(token), json={"data": {"a": 1}})
    assert client.post("/api/me/delete", headers=h(token), json={"password": "bad"}).status_code == 403
    assert client.post("/api/me/delete", headers=h(token), json={"password": "password123"}).status_code == 200
    assert client.get("/api/me", headers=h(token)).status_code == 401
    assert client.post("/api/auth/login", json={"login": login, "password": "password123"}).status_code == 401


# ---------- слушать вместе ----------

def ws_hello(client, token):
    ws = client.websocket_connect("/api/together").__enter__()
    ws.send_json({"t": "hello", "token": token})
    assert ws.receive_json()["t"] == "hello"
    return ws


def test_together_needs_login(client):
    with client.websocket_connect("/api/together") as ws:
        ws.send_json({"t": "hello", "token": "nope"})
        msg = ws.receive_json()
        assert msg["t"] == "error" and msg["fatal"]


def test_together_room_flow(client):
    t1, _ = register(client)
    t2, _ = register(client)
    a = ws_hello(client, t1)
    b = ws_hello(client, t2)
    try:
        a.send_json({"t": "create"})
        room = a.receive_json()
        assert room["t"] == "room" and len(room["code"]) == 6 and room["state"] is None

        b.send_json({"t": "join", "code": "nope00"})
        assert b.receive_json()["t"] == "error"

        b.send_json({"t": "join", "code": room["code"].lower()})
        joined = b.receive_json()
        assert joined["t"] == "room" and len(joined["members"]) == 2
        assert a.receive_json()["t"] == "members"

        track = {"id": "ym:1", "source": "ym", "title": "Трек", "artist": "Артист"}
        a.send_json({"t": "state", "state": {"track": track, "playing": True, "pos": 12.5}})
        st = b.receive_json()
        assert st["t"] == "state" and st["state"]["track"] == track and st["state"]["pos"] == 12.5
        assert st["driver"] == room["you"] and st["state"]["at"] > 0

        # вошедший позже получает текущее состояние сразу
        t3, _ = register(client)
        c = ws_hello(client, t3)
        c.send_json({"t": "join", "code": room["code"]})
        late = c.receive_json()
        assert late["state"]["track"]["id"] == "ym:1" and late["driver"] == room["you"]
        c.send_json({"t": "leave"})

        b.send_json({"t": "ping", "c": 1})
        # до pong у b могут прийти members от ухода c
        msgs = [b.receive_json(), b.receive_json(), b.receive_json()]
        assert any(m["t"] == "pong" and m["c"] == 1 for m in msgs)
    finally:
        a.__exit__(None, None, None)
        b.__exit__(None, None, None)


def test_share_album_and_eq(client):
    token, _ = register(client)
    other, _ = register(client)
    album = {"title": "в дорогу", "tracks": [{"id": "ym:1", "source": "ym", "title": "трек"}]}
    r = client.post("/api/share", json={"kind": "album", "data": album}, headers=h(token))
    assert r.status_code == 200, r.text
    code = r.json()["code"]
    assert len(code) == 8

    # друг вводит код как угодно: строчными, с дефисом и пробелами
    pretty = f"{code[:4].lower()}-{code[4:]} "
    r = client.get(f"/api/share/{pretty}", headers=h(other))
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "album" and r.json()["data"] == album

    assert client.get("/api/share/AAAAAAAA", headers=h(other)).status_code == 404
    assert client.get(f"/api/share/{code}").status_code == 401
    assert client.post("/api/share", json={"kind": "settings", "data": {}}, headers=h(token)).status_code == 400
    r = client.post("/api/share", json={"kind": "eq", "data": {"name": "бас", "gains": [1] * 10, "preamp": -1}}, headers=h(token))
    assert r.status_code == 200


def test_avatar(client):
    import base64
    token, _ = register(client)
    other, _ = register(client)
    me = client.get("/api/me", headers=h(token)).json()["user"]
    assert me["avatar_at"] == 0
    assert client.get(f"/api/avatar/{me['id']}", headers=h(other)).status_code == 404

    png = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 100).decode()
    r = client.put("/api/me/avatar", json={"avatar": f"data:image/png;base64,{png}"}, headers=h(token))
    assert r.status_code == 200, r.text
    assert r.json()["user"]["avatar_at"] > 0
    r = client.get(f"/api/avatar/{me['id']}", headers=h(other))
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert r.content.startswith(b"\x89PNG")
    assert client.get(f"/api/avatar/{me['id']}").status_code == 401

    bad = client.put("/api/me/avatar", json={"avatar": "data:text/html;base64,PGI+"}, headers=h(token))
    assert bad.status_code == 400
    big = base64.b64encode(b"0" * (300 * 1024)).decode()
    assert client.put("/api/me/avatar", json={"avatar": f"data:image/png;base64,{big}"}, headers=h(token)).status_code in (413, 422)

    assert client.put("/api/me/avatar", json={"avatar": ""}, headers=h(token)).status_code == 200
    assert client.get(f"/api/avatar/{me['id']}", headers=h(other)).status_code == 404

