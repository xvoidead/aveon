"""Друзья и «что слушает друг».

Дружба — по логину: один отправляет заявку, второй принимает. Если оба отправили заявки друг другу,
дружба начинается сразу. Плеер сообщает серверу, что у него играет, и раз в минуту напоминает;
друзья видят трек, паузу и позицию. Кто давно не напоминал — не в сети, виден только последний трек.

  GET    /api/friends                 → {friends, incoming, outgoing, now}
  POST   /api/friends          {login} → {status: "sent" | "friends"}
  POST   /api/friends/{id}/accept     → {ok}
  DELETE /api/friends/{id}            → {ok}   удалить из друзей, отклонить или отозвать заявку
  PUT    /api/now    {track, playing, pos} → {ok}   track: null — ничего не играет
"""
from __future__ import annotations

import json
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import db
from .app import Me

router = APIRouter()

MAX_FRIENDS = 200
MAX_OUTGOING = 50  # висящих заявок от одного человека
MAX_TRACK = 16 * 1024  # JSON трека
LIVE_FOR = 150  # с без напоминаний — плеер закрыт


class AddFriend(BaseModel):
    login: str = Field(max_length=64)


class NowPlaying(BaseModel):
    track: dict[str, Any] | None = None
    playing: bool = False
    pos: float = Field(default=0, ge=0, le=24 * 3600)


def now_ms() -> int:
    return int(time.time() * 1000)


def person(row) -> dict:
    return {"id": row["id"], "login": row["login"], "name": row["name"], "avatar": row["avatar_at"]}


def are_friends(conn, a: int, b: int) -> bool:
    return bool(conn.execute("SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?", (a, b)).fetchone())


def make_friends(conn, a: int, b: int) -> None:
    t = int(time.time())
    conn.execute("DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)", (a, b, b, a))
    conn.executemany("INSERT OR IGNORE INTO friends (user_id, friend_id, since) VALUES (?, ?, ?)", [(a, b, t), (b, a, t)])


def friend_count(conn, user_id: int) -> int:
    return conn.execute("SELECT COUNT(*) FROM friends WHERE user_id = ?", (user_id,)).fetchone()[0]


@router.get("/api/friends")
def friends_list(me: Me):
    t = now_ms()
    with db.tx() as conn:
        friends = conn.execute(
            "SELECT u.id, u.login, u.name, u.avatar_at, f.since, n.track, n.playing, n.pos, n.at "
            "FROM friends f JOIN users u ON u.id = f.friend_id LEFT JOIN nowplaying n ON n.user_id = u.id "
            "WHERE f.user_id = ?",
            (me.user_id,),
        ).fetchall()
        incoming = conn.execute(
            "SELECT u.id, u.login, u.name, u.avatar_at, r.created FROM friend_requests r "
            "JOIN users u ON u.id = r.from_id WHERE r.to_id = ? ORDER BY r.created DESC",
            (me.user_id,),
        ).fetchall()
        outgoing = conn.execute(
            "SELECT u.id, u.login, u.name, u.avatar_at, r.created FROM friend_requests r "
            "JOIN users u ON u.id = r.to_id WHERE r.from_id = ? ORDER BY r.created DESC",
            (me.user_id,),
        ).fetchall()

    def view(r) -> dict:
        now = None
        if r["track"]:
            live = t - r["at"] < LIVE_FOR * 1000
            now = {"track": json.loads(r["track"]), "playing": bool(r["playing"]) and live,
                   "pos": r["pos"], "at": r["at"], "live": live}
        return person(r) | {"since": r["since"], "now": now}

    items = [view(r) for r in friends]
    # сверху — кто слушает прямо сейчас, потом кто в сети, потом по времени последнего трека
    items.sort(key=lambda f: (
        not (f["now"] and f["now"]["playing"]), not (f["now"] and f["now"]["live"]),
        -(f["now"]["at"] if f["now"] else 0), f["name"].lower(),
    ))
    return {
        "friends": items,
        "incoming": [person(r) | {"created": r["created"]} for r in incoming],
        "outgoing": [person(r) | {"created": r["created"]} for r in outgoing],
        "now": t,
    }


@router.post("/api/friends")
def friends_add(body: AddFriend, me: Me):
    login = body.login.strip().lstrip("@").lower()
    if not login:
        raise HTTPException(400, "Впиши логин друга")
    with db.tx() as conn:
        other = conn.execute("SELECT id FROM users WHERE login = ?", (login,)).fetchone()
        if not other:
            raise HTTPException(404, f"Нет пользователя с логином @{login}")
        oid = other["id"]
        if oid == me.user_id:
            raise HTTPException(400, "Это твой собственный логин")
        if are_friends(conn, me.user_id, oid):
            raise HTTPException(409, "Вы уже друзья")
        if friend_count(conn, me.user_id) >= MAX_FRIENDS:
            raise HTTPException(400, f"Друзей может быть не больше {MAX_FRIENDS}")
        # он уже звал нас — значит, просто принимаем
        if conn.execute("SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?", (oid, me.user_id)).fetchone():
            if friend_count(conn, oid) >= MAX_FRIENDS:
                raise HTTPException(400, "У друга уже слишком много друзей")
            make_friends(conn, me.user_id, oid)
            return {"status": "friends"}
        if conn.execute("SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?", (me.user_id, oid)).fetchone():
            return {"status": "sent"}
        pending = conn.execute("SELECT COUNT(*) FROM friend_requests WHERE from_id = ?", (me.user_id,)).fetchone()[0]
        if pending >= MAX_OUTGOING:
            raise HTTPException(429, "Слишком много заявок ждут ответа. Отзови старые")
        conn.execute(
            "INSERT INTO friend_requests (from_id, to_id, created) VALUES (?, ?, ?)",
            (me.user_id, oid, int(time.time())),
        )
    return {"status": "sent"}


@router.post("/api/friends/{user_id}/accept")
def friends_accept(user_id: int, me: Me):
    with db.tx() as conn:
        if not conn.execute("SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?", (user_id, me.user_id)).fetchone():
            raise HTTPException(404, "Заявки уже нет")
        if friend_count(conn, me.user_id) >= MAX_FRIENDS or friend_count(conn, user_id) >= MAX_FRIENDS:
            raise HTTPException(400, f"Друзей может быть не больше {MAX_FRIENDS}")
        make_friends(conn, me.user_id, user_id)
    return {"ok": True}


@router.delete("/api/friends/{user_id}")
def friends_remove(user_id: int, me: Me):
    a, b = me.user_id, user_id
    with db.tx() as conn:
        conn.execute("DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)", (a, b, b, a))
        conn.execute("DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)", (a, b, b, a))
    return {"ok": True}


@router.put("/api/now")
def now_put(body: NowPlaying, me: Me):
    with db.tx() as conn:
        if body.track is None:
            conn.execute("DELETE FROM nowplaying WHERE user_id = ?", (me.user_id,))
            return {"ok": True}
        track = json.dumps(body.track, ensure_ascii=False, separators=(",", ":"))
        if len(track.encode()) > MAX_TRACK or not str(body.track.get("title") or "").strip():
            raise HTTPException(400, "Неверный трек")
        conn.execute(
            "INSERT INTO nowplaying (user_id, track, playing, pos, at) VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT (user_id) DO UPDATE SET track = excluded.track, playing = excluded.playing, "
            "pos = excluded.pos, at = excluded.at",
            (me.user_id, track, int(body.playing), body.pos, now_ms()),
        )
    return {"ok": True}
