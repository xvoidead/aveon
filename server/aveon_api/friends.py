"""Друзья и «что слушает друг».

Дружба — по логину: один отправляет заявку, второй принимает. Если оба отправили заявки друг другу,
дружба начинается сразу. Плеер сообщает серверу, что у него играет, и раз в минуту напоминает;
друзья видят трек, паузу и позицию. Кто давно не напоминал — не в сети, виден только последний трек.

  GET    /api/friends                 → {friends, incoming, outgoing, now}
  POST   /api/friends          {login} → {status: "sent" | "friends"}
  POST   /api/friends/{id}/accept     → {ok}
  DELETE /api/friends/{id}            → {ok}   удалить из друзей, отклонить или отозвать заявку
  PUT    /api/now    {track, playing, pos} → {ok}   track: null — ничего не играет
  POST   /api/friends/{id}/invite {code}  → {ok}   позвать друга в руму
  DELETE /api/friends/{id}/invite         → {ok}   убрать приглашение от друга (вошёл или отказался)

  POST   /api/friends/{id}/knock          → {ok}   попроситься в руму к другу (он сейчас в руме)
  DELETE /api/friends/{id}/knock          → {ok}   убрать просьбу друга (пустил или отказал)

Приглашения и просьбы живут в памяти 10 минут и пропадают, когда рума закрылась.
"""
from __future__ import annotations

import json
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import db
from .app import Me
from .together import ROOMS

router = APIRouter()

MAX_FRIENDS = 200
MAX_OUTGOING = 50  # висящих заявок от одного человека
MAX_TRACK = 16 * 1024  # JSON трека
LIVE_FOR = 150  # с без напоминаний — плеер закрыт
INVITE_FOR = 10 * 60  # с

# кому → {от кого → {code, at}}
INVITES: dict[int, dict[int, dict]] = {}
# кому → {кто просится → когда}
KNOCKS: dict[int, dict[int, float]] = {}


def in_rooms() -> set[int]:
    return {m.user_id for r in ROOMS.values() for m in r.members.values()}


def fresh_knocks(user_id: int) -> dict[int, float]:
    mine = KNOCKS.get(user_id, {})
    if user_id not in in_rooms():
        mine.clear()
    t = time.time()
    for s in [s for s, at in mine.items() if t - at > INVITE_FOR]:
        del mine[s]
    if not mine:
        KNOCKS.pop(user_id, None)
    return mine


class AddFriend(BaseModel):
    login: str = Field(max_length=64)


class Invite(BaseModel):
    code: str = Field(max_length=16)


def fresh_invites(user_id: int) -> dict[int, dict]:
    t = time.time()
    mine = INVITES.get(user_id, {})
    for sender in [s for s, inv in mine.items() if t - inv["at"] > INVITE_FOR or inv["code"] not in ROOMS]:
        del mine[sender]
    if not mine:
        INVITES.pop(user_id, None)
    return mine


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
        invites = fresh_invites(me.user_id)
        knocks = fresh_knocks(me.user_id)
        ids = list(set(invites) | set(knocks))
        senders = {
            r["id"]: r for r in conn.execute(
                f"SELECT id, login, name, avatar_at FROM users WHERE id IN ({','.join('?' * len(ids))})", ids,
            )
        } if ids else {}
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
        return person(r) | {"since": r["since"], "now": now, "in_room": r["id"] in busy,
                            "unread": unread.get(r["id"], {}).get("unread", 0), "last": unread.get(r["id"], {}).get("last")}

    busy = in_rooms()
    from .messages import unread_by_friend  # messages.py импортирует этот модуль
    with db.tx() as conn:
        unread = unread_by_friend(conn, me.user_id)
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
        "invites": [person(senders[s]) | {"code": inv["code"], "at": int(inv["at"])}
                    for s, inv in sorted(invites.items(), key=lambda x: -x[1]["at"]) if s in senders],
        "knocks": [person(senders[s]) | {"at": int(at)} for s, at in sorted(knocks.items(), key=lambda x: -x[1]) if s in senders],
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


@router.post("/api/friends/{user_id}/invite")
def friends_invite(user_id: int, body: Invite, me: Me):
    code = body.code.strip().upper()
    if code not in ROOMS:
        raise HTTPException(404, "Рума уже закрылась")
    with db.tx() as conn:
        if not are_friends(conn, me.user_id, user_id):
            raise HTTPException(403, "Звать в руму можно только друзей")
    INVITES.setdefault(user_id, {})[me.user_id] = {"code": code, "at": time.time()}
    KNOCKS.get(me.user_id, {}).pop(user_id, None)  # он просился — считаем, что пустили
    return {"ok": True}


@router.delete("/api/friends/{user_id}/invite")
def friends_invite_dismiss(user_id: int, me: Me):
    INVITES.get(me.user_id, {}).pop(user_id, None)
    return {"ok": True}


@router.post("/api/friends/{user_id}/knock")
def friends_knock(user_id: int, me: Me):
    with db.tx() as conn:
        if not are_friends(conn, me.user_id, user_id):
            raise HTTPException(403, "Проситься можно только к друзьям")
    if user_id not in in_rooms():
        raise HTTPException(404, "Друг уже не в руме")
    KNOCKS.setdefault(user_id, {})[me.user_id] = time.time()
    return {"ok": True}


@router.delete("/api/friends/{user_id}/knock")
def friends_knock_dismiss(user_id: int, me: Me):
    KNOCKS.get(me.user_id, {}).pop(user_id, None)
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


# ---------- профиль друга ----------
# Сводка по статистике прослушивания, которую плееры и так синхронизируют (docs kind=stats, по компьютеру).
# Отдаётся только друзьям и только сводка: сколько слушал и что чаще всего

TOP = 8


@router.get("/api/friends/{user_id}/profile")
def friends_profile(user_id: int, me: Me):
    month = time.strftime("%Y-%m")
    with db.tx() as conn:
        if not are_friends(conn, me.user_id, user_id):
            raise HTTPException(403, "Профиль виден только друзьям")
        u = conn.execute(
            "SELECT u.id, u.login, u.name, u.avatar_at, u.created, f.since FROM users u "
            "JOIN friends f ON f.friend_id = u.id AND f.user_id = ? WHERE u.id = ?",
            (me.user_id, user_id),
        ).fetchone()
        docs = conn.execute("SELECT data FROM docs WHERE user_id = ? AND kind = 'stats'", (user_id,)).fetchall()
        np = conn.execute("SELECT track, playing, pos, at FROM nowplaying WHERE user_id = ?", (user_id,)).fetchone()

    total = month_sec = 0.0
    days: set[str] = set()
    tracks: dict[str, dict] = {}
    for d in docs:
        try:
            data = json.loads(d["data"])
        except ValueError:
            continue
        for day, sec in (data.get("days") or {}).items():
            if isinstance(sec, (int, float)) and sec > 0:
                total += sec
                days.add(day)
                if day.startswith(month):
                    month_sec += sec
        for key, t in (data.get("tracks") or {}).items():
            if not isinstance(t, dict) or not isinstance(t.get("t"), dict):
                continue
            cur = tracks.setdefault(key, {"track": t["t"], "sec": 0.0, "plays": 0})
            cur["sec"] += float(t.get("sec") or 0)
            cur["plays"] += int(t.get("plays") or 0)

    artists: dict[str, float] = {}
    for t in tracks.values():
        for name in str(t["track"].get("artist") or "").split(","):
            name = name.strip()
            if name:
                artists[name] = artists.get(name, 0) + t["sec"]

    def slim(t: dict) -> dict:
        keep = ("id", "source", "title", "artist", "album", "duration", "cover", "link", "ref")
        return {k: t[k] for k in keep if k in t}

    top = sorted(tracks.values(), key=lambda x: -x["sec"])[:TOP]
    t = now_ms()
    now = None
    if np:
        live = t - np["at"] < LIVE_FOR * 1000
        now = {"track": json.loads(np["track"]), "playing": bool(np["playing"]) and live, "pos": np["pos"], "at": np["at"], "live": live}
    return {
        "user": person(u) | {"since": u["since"], "created": u["created"]},
        "now": now,
        "in_room": user_id in in_rooms(),
        "stats": {
            "total": round(total), "month": round(month_sec), "days": len(days),
            "tracks": [{"track": slim(x["track"]), "sec": round(x["sec"]), "plays": x["plays"]} for x in top],
            "artists": [{"name": n, "sec": round(s)} for n, s in sorted(artists.items(), key=lambda x: -x[1])[:TOP]],
        },
        "server_now": t,
    }
