"""Тесты API — чёрным ящиком: каждый тест запускает собранный сервер на чистой базе.

  go build -o aveon.exe .   (на Linux/macOS: -o aveon)
  pip install pytest httpx websockets
  python -m pytest tests

Путь к бинарнику можно задать переменной AVEON_BIN.
"""
import json
import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx
import pytest
from websockets.sync.client import connect

ROOT = Path(__file__).resolve().parent.parent
BIN = Path(os.environ.get("AVEON_BIN") or ROOT / ("aveon.exe" if sys.platform == "win32" else "aveon"))
ADMIN = "admtest"


class WS:
    """Как websocket у TestClient: send_json / receive_json, закрыть — __exit__."""

    def __init__(self, url):
        self.url = url

    def __enter__(self):
        self.cm = connect(self.url, open_timeout=5, max_size=None, proxy=None)
        self.c = self.cm.__enter__()
        return self

    def __exit__(self, *exc):
        self.cm.__exit__(None, None, None)

    def send_json(self, msg):
        self.c.send(json.dumps(msg))

    def send_text(self, text):
        self.c.send(text)

    def receive_json(self):
        return json.loads(self.c.recv(timeout=5))


class Client(httpx.Client):
    def websocket_connect(self, path):
        return WS(self.ws_base + path)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture()
def server():
    if not BIN.exists():
        pytest.fail(f"нет бинарника {BIN}: собери go build")
    folder = Path(tempfile.mkdtemp())
    port = free_port()
    env = os.environ | {"AVEON_HOST": "127.0.0.1", "AVEON_PORT": str(port), "AVEON_DB": str(folder / "test.db"),
                        "AVEON_ADMINS": ADMIN, "AVEON_BACKUPS": str(folder / "backups")}
    proc = subprocess.Popen([str(BIN)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            if httpx.get(base + "/api/health", trust_env=False).status_code == 200:
                break
        except httpx.HTTPError:
            time.sleep(0.05)
    else:
        proc.kill()
        pytest.fail("сервер не запустился")
    yield {"base": base, "db": folder / "test.db", "folder": folder}
    proc.terminate()
    proc.wait(5)


@pytest.fixture()
def client(server):
    with Client(base_url=server["base"], timeout=10, trust_env=False) as c:  # мимо системного прокси
        c.ws_base = server["base"].replace("http://", "ws://")
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



# ---------- друзья ----------

def uid(client, token):
    return client.get("/api/me", headers=h(token)).json()["user"]["id"]


def test_friends_request_accept_remove(client):
    t1, l1 = register(client)
    t2, l2 = register(client)
    id1, id2 = uid(client, t1), uid(client, t2)

    assert client.post("/api/friends", json={"login": "nobody-here"}, headers=h(t1)).status_code == 404
    assert client.post("/api/friends", json={"login": l1}, headers=h(t1)).status_code == 400
    r = client.post("/api/friends", json={"login": "@" + l2.upper()}, headers=h(t1))
    assert r.json() == {"status": "sent"}

    lst = client.get("/api/friends", headers=h(t2)).json()
    assert lst["incoming"][0]["id"] == id1 and lst["friends"] == []
    assert client.get("/api/friends", headers=h(t1)).json()["outgoing"][0]["login"] == l2

    # до дружбы трек не виден
    client.put("/api/now", json={"track": {"id": "ym:1", "title": "Трек"}, "playing": True, "pos": 3}, headers=h(t2))
    assert client.get("/api/friends", headers=h(t1)).json()["friends"] == []

    assert client.post(f"/api/friends/{id2}/accept", headers=h(t1)).status_code == 404  # свою заявку принять нельзя
    assert client.post(f"/api/friends/{id1}/accept", headers=h(t2)).status_code == 200
    f = client.get("/api/friends", headers=h(t1)).json()
    assert f["outgoing"] == [] and f["friends"][0]["id"] == id2
    now = f["friends"][0]["now"]
    assert now["track"]["title"] == "Трек" and now["playing"] and now["live"] and now["pos"] == 3
    assert client.post("/api/friends", json={"login": l2}, headers=h(t1)).status_code == 409

    client.put("/api/now", json={"track": None}, headers=h(t2))
    assert client.get("/api/friends", headers=h(t1)).json()["friends"][0]["now"] is None

    assert client.delete(f"/api/friends/{id1}", headers=h(t2)).status_code == 200
    assert client.get("/api/friends", headers=h(t1)).json()["friends"] == []


def test_friends_mutual_requests(client):
    t1, l1 = register(client)
    t2, l2 = register(client)
    assert client.post("/api/friends", json={"login": l2}, headers=h(t1)).json()["status"] == "sent"
    assert client.post("/api/friends", json={"login": l1}, headers=h(t2)).json()["status"] == "friends"
    assert len(client.get("/api/friends", headers=h(t1)).json()["friends"]) == 1


def test_now_stale_and_validation(client, server):
    t1, l1 = register(client)
    t2, l2 = register(client)
    client.post("/api/friends", json={"login": l2}, headers=h(t1))
    client.post("/api/friends", json={"login": l1}, headers=h(t2))
    assert client.put("/api/now", json={"track": {"id": "x"}, "playing": True}, headers=h(t2)).status_code == 400
    assert client.put("/api/now", json={"track": {"title": "a"}}).status_code == 401
    client.put("/api/now", json={"track": {"id": "x", "title": "Старое"}, "playing": True, "pos": 1}, headers=h(t2))
    with sqlite3.connect(server["db"]) as conn:
        conn.execute("UPDATE nowplaying SET at = at - 3600000 WHERE user_id = ?", (uid(client, t2),))
    now = client.get("/api/friends", headers=h(t1)).json()["friends"][0]["now"]
    assert now["track"]["title"] == "Старое" and not now["live"] and not now["playing"]


def test_room_invite_and_knock(client):
    t1, l1 = register(client)
    t2, l2 = register(client)
    id1, id2 = uid(client, t1), uid(client, t2)
    client.post("/api/friends", json={"login": l2}, headers=h(t1))
    client.post("/api/friends", json={"login": l1}, headers=h(t2))

    assert client.post(f"/api/friends/{id2}/invite", json={"code": "ZZZZZZ"}, headers=h(t1)).status_code == 404
    assert client.post(f"/api/friends/{id1}/knock", headers=h(t2)).status_code == 404  # друг не в руме

    a = ws_hello(client, t1)
    try:
        a.send_json({"t": "create"})
        code = a.receive_json()["code"]
        f = client.get("/api/friends", headers=h(t2)).json()["friends"][0]
        assert f["in_room"] is True
        assert client.post(f"/api/friends/{id1}/knock", headers=h(t2)).status_code == 200
        assert client.get("/api/friends", headers=h(t1)).json()["knocks"][0]["id"] == id2

        assert client.post(f"/api/friends/{id2}/invite", json={"code": code.lower()}, headers=h(t1)).status_code == 200
        d = client.get("/api/friends", headers=h(t2)).json()
        assert d["invites"][0]["code"] == code and d["invites"][0]["id"] == id1
        assert client.get("/api/friends", headers=h(t1)).json()["knocks"] == []  # пустили — просьба ушла

        client.delete(f"/api/friends/{id1}/invite", headers=h(t2))
        assert client.get("/api/friends", headers=h(t2)).json()["invites"] == []
    finally:
        a.__exit__(None, None, None)


def test_messages(client):
    t1, l1 = register(client)
    t2, l2 = register(client)
    t3, _ = register(client)
    id1, id2 = uid(client, t1), uid(client, t2)
    assert client.post(f"/api/messages/{id2}", json={"text": "привет"}, headers=h(t1)).status_code == 403
    client.post("/api/friends", json={"login": l2}, headers=h(t1))
    client.post("/api/friends", json={"login": l1}, headers=h(t2))

    assert client.post(f"/api/messages/{id2}", json={"text": "  "}, headers=h(t1)).status_code == 400
    r = client.post(f"/api/messages/{id2}", json={"text": "послушай"}, headers=h(t1))
    assert r.status_code == 200 and r.json()["message"]["mine"]
    track = {"id": "ym:1", "source": "ym", "title": "Трек", "artist": "Артист"}
    client.post(f"/api/messages/{id2}", json={"track": track}, headers=h(t1))

    f = client.get("/api/friends", headers=h(t2)).json()["friends"][0]
    assert f["unread"] == 2 and f["last"]["track_title"] == "Трек"

    msgs = client.get(f"/api/messages/{id1}", headers=h(t2)).json()["messages"]
    assert [m["text"] for m in msgs] == ["послушай", ""] and msgs[1]["track"] == track and not msgs[0]["mine"]
    assert client.get("/api/friends", headers=h(t2)).json()["friends"][0]["unread"] == 0
    assert client.get(f"/api/messages/{id1}?before={msgs[1]['id']}", headers=h(t2)).json()["messages"][0]["text"] == "послушай"
    assert client.get(f"/api/messages/{id1}", headers=h(t3)).status_code == 403


def test_friend_profile(client):
    t1, l1 = register(client)
    t2, l2 = register(client)
    id1, id2 = uid(client, t1), uid(client, t2)
    assert client.get(f"/api/friends/{id2}/profile", headers=h(t1)).status_code == 403
    client.post("/api/friends", json={"login": l2}, headers=h(t1))
    client.post("/api/friends", json={"login": l1}, headers=h(t2))
    tr = lambda i, a: {"t": {"id": f"ym:{i}", "title": f"t{i}", "artist": a, "ref": {}}, "sec": i * 100, "plays": i, "m": {}}
    for dev, data in (("pc", {"v": 1, "days": {"2026-01-01": 300}, "tracks": {"ym:1": tr(1, "A, B"), "ym:2": tr(2, "B")}}),
                      ("laptop", {"v": 1, "days": {"2026-01-02": 200}, "tracks": {"ym:2": tr(2, "B")}})):
        client.put(f"/api/sync/stats/{dev}", json={"data": data, "base_rev": None}, headers=h(t2))
    p = client.get(f"/api/friends/{id2}/profile", headers=h(t1)).json()
    assert p["user"]["login"] == l2 and p["stats"]["total"] == 500 and p["stats"]["days"] == 2
    assert p["stats"]["tracks"][0]["track"]["id"] == "ym:2" and p["stats"]["tracks"][0]["sec"] == 400
    assert p["stats"]["artists"][0] == {"name": "B", "sec": 500}


def test_admin(client):
    t_user, l_user = register(client)
    login = ADMIN
    if True:
        t_adm = client.post("/api/auth/register", json={"login": login, "password": "password123"}).json()["token"]
        assert client.get("/api/me", headers=h(t_adm)).json()["user"]["admin"] is True
        assert client.get("/api/admin/overview", headers=h(t_user)).status_code == 403
        o = client.get("/api/admin/overview", headers=h(t_adm)).json()
        assert o["users"]["total"] >= 2 and "rooms" in o
        uid_user = uid(client, t_user)
        found = client.get(f"/api/admin/users?q={l_user}", headers=h(t_adm)).json()["users"]
        assert found[0]["id"] == uid_user and found[0]["sessions"] == 1

        assert client.post(f"/api/admin/users/{uid_user}/ban", json={"banned": True}, headers=h(t_adm)).status_code == 200
        assert client.get("/api/me", headers=h(t_user)).status_code == 401
        assert client.post("/api/auth/login", json={"login": l_user, "password": "password123"}).status_code == 403
        client.post(f"/api/admin/users/{uid_user}/ban", json={"banned": False}, headers=h(t_adm))
        assert client.post("/api/auth/login", json={"login": l_user, "password": "password123"}).status_code == 200
        assert client.post(f"/api/admin/users/{uid(client, t_adm)}/ban", json={"banned": True}, headers=h(t_adm)).status_code == 400

        client.put("/api/admin/announce", json={"text": "сервер перезапустится в 23:00"}, headers=h(t_adm))
        t_user2, _ = register(client)
        assert client.get("/api/announce", headers=h(t_user2)).json()["announce"]["text"].startswith("сервер")
        client.put("/api/admin/announce", json={"text": ""}, headers=h(t_adm))
        assert client.get("/api/announce", headers=h(t_user2)).json()["announce"] is None
        o = client.get("/api/admin/overview", headers=h(t_adm)).json()
        assert len(o["series"]["users"]) == 30 and o["series"]["users"][-1] >= 2 and "leaders" in o["top"]
        assert client.post(f"/api/admin/users/{uid(client, t_user2)}/notify", json={"text": "привет"}, headers=h(t_adm)).status_code == 200
        assert client.get("/api/announce", headers=h(t_user2)).json()["notice"]["text"] == "привет"


# ---------- совместные плейлисты ----------

def tr(i, title=None):
    return {"id": f"ym:{i}", "source": "ym", "title": title or f"трек {i}", "artist": "a"}


def test_collab_flow(client):
    t1, _ = register(client)
    t2, _ = register(client)
    t3, _ = register(client)
    id1, id2 = uid(client, t1), uid(client, t2)

    code = client.post("/api/collab", json={"title": "  на тусу ", "tracks": [tr(1), tr(2), tr(1)]}, headers=h(t1)).json()["code"]
    assert len(code) == 8
    assert client.get(f"/api/collab/{code}", headers=h(t2)).status_code == 403
    assert client.post("/api/collab/AAAAAAAA/join", headers=h(t2)).json()["error"] == "Такого плейлиста нет. Проверь код"

    j = client.post(f"/api/collab/{code.lower()}/join", headers=h(t2)).json()
    assert j["title"] == "на тусу" and [m["id"] for m in j["members"]] == [id1, id2]
    assert [t["id"] for t in j["tracks"]] == ["ym:1", "ym:2"] and j["tracks"][0]["by"]["id"] == id1
    rev = j["rev"]

    r = client.post(f"/api/collab/{code}/tracks", json={"tracks": [tr(2), tr(3)]}, headers=h(t2)).json()
    assert r["rev"] > rev
    g = client.get(f"/api/collab/{code}", headers=h(t1)).json()
    assert [t["id"] for t in g["tracks"]] == ["ym:1", "ym:2", "ym:3"] and g["tracks"][2]["by"]["id"] == id2

    # чужое удалить нельзя, своё — можно; владелец — любое
    assert client.post(f"/api/collab/{code}/remove", json={"ids": ["ym:1"]}, headers=h(t2)).status_code == 403
    client.post(f"/api/collab/{code}/remove", json={"ids": ["ym:3"]}, headers=h(t2))
    client.post(f"/api/collab/{code}/tracks", json={"tracks": [tr(4), tr(5)]}, headers=h(t2))
    client.post(f"/api/collab/{code}/remove", json={"ids": ["ym:4"]}, headers=h(t1))

    client.post(f"/api/collab/{code}/move", json={"id": "ym:5", "before": "ym:1"}, headers=h(t2))
    client.post(f"/api/collab/{code}/move", json={"id": "ym:1", "before": None}, headers=h(t2))
    assert [t["id"] for t in client.get(f"/api/collab/{code}", headers=h(t1)).json()["tracks"]] == ["ym:5", "ym:2", "ym:1"]

    assert client.patch(f"/api/collab/{code}", json={"title": "x"}, headers=h(t2)).status_code == 403
    client.patch(f"/api/collab/{code}", json={"title": "вечеринка"}, headers=h(t1))
    lst = client.get("/api/collab", headers=h(t2)).json()
    assert lst[0]["title"] == "вечеринка" and lst[0]["count"] == 3 and lst[0]["members"] == 2

    # ушёл владелец — плейлист второму; ушли все — плейлиста нет
    client.post(f"/api/collab/{code}/leave", headers=h(t1))
    assert client.get(f"/api/collab/{code}", headers=h(t2)).json()["owner"] == id2
    client.post(f"/api/collab/{code}/leave", headers=h(t2))
    assert client.post(f"/api/collab/{code}/join", headers=h(t3)).status_code == 404


def test_collab_limits(client):
    t1, _ = register(client)
    big = tr(1) | {"pad": "x" * 9000}
    assert client.post("/api/collab", json={"title": "a", "tracks": [big]}, headers=h(t1)).status_code == 413
    assert client.post("/api/collab", json={"title": " ", "tracks": []}, headers=h(t1)).status_code == 400
    assert client.post("/api/collab", json={"title": "a", "tracks": [{"id": "x"}]}, headers=h(t1)).status_code == 400


# ---------- трек по ссылке (Discord) ----------

def test_share_track_public_page(client):
    token, _ = register(client)
    track = {"id": "ym:1", "source": "ym", "title": "Трек <b>", "artist": "Арт & ко",
             "cover": "https://avatars.yandex.net/x/400x400", "link": "https://music.yandex.ru/album/1/track/1"}
    assert client.post("/api/share", json={"kind": "track", "data": {"track": {"id": "x"}}}, headers=h(token)).status_code == 400
    code = client.post("/api/share", json={"kind": "track", "data": {"track": track, "room": "ABCDEF"}}, headers=h(token)).json()["code"]

    pub = client.get(f"/api/share/{code}/public")
    assert pub.status_code == 200 and pub.json()["data"]["track"]["title"] == "Трек <b>"
    page = client.get(f"/t/{code}")
    assert page.status_code == 200 and page.headers["content-type"].startswith("text/html")
    body = page.text
    assert 'property="og:title" content="Трек &lt;b&gt; — Арт &amp; ко"' in body
    assert 'og:image" content="https://avatars.yandex.net/x/400x400"' in body
    assert "вместе с" in body and f"aveon://track/{code}" in body and "Открыть в Яндекс Музыке" in body
    assert "<b>" not in body.split("<body>")[1]

    # альбом публично не отдаётся
    album = client.post("/api/share", json={"kind": "album", "data": {"title": "a", "tracks": []}}, headers=h(token)).json()["code"]
    assert client.get(f"/api/share/{album}/public").status_code == 404
    assert client.get("/t/AAAAAAAA").status_code == 404


# ---------- реакции в руме ----------

def test_together_react(client):
    import time as _time
    t1, _ = register(client)
    t2, _ = register(client)
    a = ws_hello(client, t1)
    b = ws_hello(client, t2)
    try:
        a.send_json({"t": "create"})
        code = a.receive_json()["code"]
        b.send_json({"t": "join", "code": code})
        b.receive_json()
        a.receive_json()  # members

        a.send_json({"t": "react", "e": "🔥"})
        ra, rb = a.receive_json(), b.receive_json()
        assert ra["t"] == rb["t"] == "react" and rb["e"] == "🔥" and rb["from"] == ra["from"]

        a.send_json({"t": "react", "e": "🍕"})  # не из списка — молча
        a.send_json({"t": "react", "e": "😂"})  # сразу за 🔥 — чаще 300 мс, отбросится
        _time.sleep(0.35)
        a.send_json({"t": "react", "e": "🎉"})
        assert b.receive_json()["e"] == "🎉"
    finally:
        a.__exit__(None, None, None)
        b.__exit__(None, None, None)


def test_message_edit_react_album(client):
    t1, l1 = register(client)
    t2, l2 = register(client)
    id1, id2 = uid(client, t1), uid(client, t2)
    client.post("/api/friends", json={"login": l2}, headers=h(t1))
    client.post("/api/friends", json={"login": l1}, headers=h(t2))
    m = client.post(f"/api/messages/{id2}", json={"text": "превет"}, headers=h(t1)).json()["message"]
    assert m["edited"] == 0 and m["reactions"] == []

    assert client.patch(f"/api/messages/{id1}/{m['id']}", json={"text": "x"}, headers=h(t2)).status_code == 403
    e = client.patch(f"/api/messages/{id2}/{m['id']}", json={"text": "привет"}, headers=h(t1)).json()["message"]
    assert e["text"] == "привет" and e["edited"] > 0

    r = client.post(f"/api/messages/{id1}/{m['id']}/react", json={"e": "🔥"}, headers=h(t2)).json()["message"]
    assert r["reactions"] == [{"e": "🔥", "users": [id2]}] and r["my"] == "🔥"
    client.post(f"/api/messages/{id2}/{m['id']}/react", json={"e": "🔥"}, headers=h(t1))
    got = client.get(f"/api/messages/{id1}", headers=h(t2)).json()["messages"][0]
    assert got["reactions"] == [{"e": "🔥", "users": [id2, id1]}] and got["text"] == "привет"
    r = client.post(f"/api/messages/{id1}/{m['id']}/react", json={"e": "🔥"}, headers=h(t2)).json()["message"]  # снять
    assert r["reactions"] == [{"e": "🔥", "users": [id1]}]
    assert client.post(f"/api/messages/{id1}/{m['id']}/react", json={"e": "🍕"}, headers=h(t2)).status_code == 400

    code = client.post("/api/share", json={"kind": "album", "data": {"title": "в дорогу", "tracks": []}}, headers=h(t1)).json()["code"]
    a = client.post(f"/api/messages/{id2}", json={"album": {"code": code, "title": "в дорогу", "count": 12}}, headers=h(t1))
    assert a.status_code == 200 and a.json()["message"]["album"]["code"] == code
    assert client.post(f"/api/messages/{id2}", json={"album": {"code": "nope", "title": "x"}}, headers=h(t1)).status_code == 400


# ---------- исправления при переезде на Go ----------

def test_no_default_admins(client):
    """Раньше без AVEON_ADMINS админами считались два логина — их мог занять кто угодно."""
    r = client.post("/api/auth/register", json={"login": "xvoidead", "password": "password123"})
    token = r.json()["token"]
    assert client.get("/api/me", headers=h(token)).json()["user"]["admin"] is False
    assert client.get("/api/admin/overview", headers=h(token)).status_code == 403


def test_register_rate_limit(client):
    ip = {"X-Forwarded-For": "10.0.0.1"}  # тест ходит с 127.0.0.1 — ему, как nginx, верим
    for i in range(10):
        r = client.post("/api/auth/register", json={"login": f"reg{i}", "password": "password123"}, headers=ip)
        assert r.status_code == 200, r.text
    r = client.post("/api/auth/register", json={"login": "reg10", "password": "password123"}, headers=ip)
    assert r.status_code == 429
    other = client.post("/api/auth/register", json={"login": "reg11", "password": "password123"},
                        headers={"X-Forwarded-For": "10.0.0.2"})
    assert other.status_code == 200


def test_login_limit_per_real_ip(client):
    """За nginx все запросы приходят с одного адреса: лимит должен считать X-Forwarded-For, а не его."""
    for i in range(10):
        r = client.post("/api/auth/login", json={"login": f"nobody{i}", "password": "wrong-pass"},
                        headers={"X-Forwarded-For": "10.0.0.9"})
        assert r.status_code == 401
    assert client.post("/api/auth/login", json={"login": "nobody-x", "password": "wrong-pass"},
                       headers={"X-Forwarded-For": "10.0.0.9"}).status_code == 429
    _, login = register(client)
    assert client.post("/api/auth/login", json={"login": login, "password": "password123"},
                       headers={"X-Forwarded-For": "10.0.0.10"}).status_code == 200


def test_sync_quota(client):
    token, _ = register(client)
    for i in range(32):
        r = client.put(f"/api/sync/stats/pc{i}", json={"data": {"i": i}, "base_rev": None}, headers=h(token))
        assert r.status_code == 200, r.text
    assert client.put("/api/sync/stats/pc32", json={"data": {}, "base_rev": None}, headers=h(token)).status_code == 413
    # старые документы по-прежнему обновляются
    assert client.put("/api/sync/stats/pc0", json={"data": {"i": 100}, "base_rev": 1}, headers=h(token)).json() == {"rev": 2}


def test_body_too_big(client):
    token, _ = register(client)
    big = b'{"data": "' + b"x" * (7 * 1024 * 1024) + b'"}'
    r = client.put("/api/sync/albums/main", content=big, headers=h(token) | {"Content-Type": "application/json"})
    assert r.status_code == 413


def test_python_password_hash(client, server):
    """Хеши паролей из базы старой версии на Python подходят и новому серверу."""
    import base64
    import hashlib
    salt = b"0123456789abcdef"
    dk = hashlib.scrypt(b"old-password", salt=salt, n=2**14, r=8, p=1, dklen=32)
    stored = f"scrypt$16384$8$1${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"
    with sqlite3.connect(server["db"]) as conn:
        conn.execute("INSERT INTO users (login, name, pw_hash, created) VALUES ('oldie', 'Старожил', ?, 0)", (stored,))
    r = client.post("/api/auth/login", json={"login": "oldie", "password": "old-password"})
    assert r.status_code == 200 and r.json()["user"]["name"] == "Старожил"
    assert client.post("/api/auth/login", json={"login": "oldie", "password": "wrong-pass"}).status_code == 401


def test_together_bad_hello(client):
    with client.websocket_connect("/api/together") as ws:
        ws.send_text("[1, 2]")
        msg = ws.receive_json()
        assert msg["t"] == "error" and msg["fatal"]


def test_together_join_limit(client):
    token, _ = register(client)
    ws = ws_hello(client, token)
    try:
        for _ in range(20):
            ws.send_json({"t": "join", "code": "ZZZZZZ"})
            assert ws.receive_json()["error"].startswith("Рума не найдена")
        ws.send_json({"t": "join", "code": "ZZZZZZ"})
        assert "Слишком много" in ws.receive_json()["error"]
    finally:
        ws.__exit__(None, None, None)


def test_backup_created(client, server):
    backups = list((server["folder"] / "backups").glob("aveon-*.db"))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as conn:
        assert conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] >= 0
