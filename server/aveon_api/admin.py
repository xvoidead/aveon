"""Админка: только для логинов из AVEON_ADMINS (по умолчанию xvoidead, htdealwme).

  GET  /api/admin/overview                 → сводка: пользователи, кто онлайн и что слушает, румы, сообщения
  GET  /api/admin/users?q=&limit=          → пользователи (поиск по логину и имени)
  POST /api/admin/users/{id}/logout        → закрыть все его сессии
  POST /api/admin/users/{id}/ban {banned}  → заблокировать (и выкинуть отовсюду) / разблокировать
  POST /api/admin/users/{id}/rename {name} → сменить имя (например, за оскорбительное)
  PUT  /api/admin/announce {text, track?}  → объявление всем (с треком — «трек дня»); пустой текст — убрать
  POST /api/admin/users/{id}/notify {text} → личное уведомление одному
  GET  /api/announce                       → объявление и личное уведомление (для всех вошедших)
"""
from __future__ import annotations

import json
import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import db
from .app import Auth, Me, auth, is_admin

router = APIRouter()

LIVE_FOR = 150  # с: как в friends.py — кто давно не напоминал о треке, тот не в сети
STARTED = int(time.time())
TOP_CACHE = {"at": 0, "data": None}  # общий топ по статистике всех — считать дорого, держим минуту


def admin(me: Annotated[Auth, Depends(auth)]) -> Auth:
    with db.tx() as conn:
        row = conn.execute("SELECT login FROM users WHERE id = ?", (me.user_id,)).fetchone()
    if not row or not is_admin(row["login"]):
        raise HTTPException(403, "Только для админов")
    return me


Admin = Annotated[Auth, Depends(admin)]


class Ban(BaseModel):
    banned: bool


class Rename(BaseModel):
    name: str = Field(max_length=64)


class Announce(BaseModel):
    text: str = Field(default="", max_length=500)
    track: dict | None = None  # «трек дня»: у всех в баннере кнопка ▶


class Notify(BaseModel):
    text: str = Field(max_length=500)


def per_day(conn, sql: str, since: int, days: int) -> list[int]:
    """Сколько событий в каждый из последних days дней (created — unix-время)."""
    out = [0] * days
    start = since - since % 86400
    for row in conn.execute(sql, (start,)):
        i = (row[0] - start) // 86400
        if 0 <= i < days:
            out[i] += 1
    return out


def global_top(conn) -> dict:
    """Общий топ сервера и рейтинг слушателей месяца — по синхронизированной статистике всех."""
    if TOP_CACHE["data"] and time.time() - TOP_CACHE["at"] < 60:
        return TOP_CACHE["data"]
    month = time.strftime("%Y-%m")
    tracks: dict[str, dict] = {}
    artists: dict[str, float] = {}
    users: dict[int, float] = {}
    total = 0.0
    for r in conn.execute("SELECT user_id, data FROM docs WHERE kind = 'stats'"):
        try:
            data = json.loads(r["data"])
        except ValueError:
            continue
        for day, sec in (data.get("days") or {}).items():
            if isinstance(sec, (int, float)):
                total += sec
                if day.startswith(month):
                    users[r["user_id"]] = users.get(r["user_id"], 0) + sec
        for key, t in (data.get("tracks") or {}).items():
            if not isinstance(t, dict) or not isinstance(t.get("t"), dict):
                continue
            sec = float(t.get("sec") or 0)
            cur = tracks.setdefault(key, {"track": t["t"], "sec": 0.0, "plays": 0, "users": set()})
            cur["sec"] += sec
            cur["plays"] += int(t.get("plays") or 0)
            cur["users"].add(r["user_id"])
            for name in str(t["t"].get("artist") or "").split(","):
                if name.strip():
                    artists[name.strip()] = artists.get(name.strip(), 0) + sec
    keep = ("id", "source", "title", "artist", "album", "duration", "cover", "link", "ref")
    names = {x["id"]: x for x in conn.execute("SELECT id, login, name, avatar_at FROM users")}
    data = {
        "total": round(total),
        "tracks": [{"track": {k: x["track"][k] for k in keep if k in x["track"]}, "sec": round(x["sec"]),
                    "plays": x["plays"], "users": len(x["users"])}
                   for x in sorted(tracks.values(), key=lambda x: -x["sec"])[:10]],
        "artists": [{"name": n, "sec": round(v)} for n, v in sorted(artists.items(), key=lambda x: -x[1])[:24]],
        "leaders": [{"id": u, "login": names[u]["login"], "name": names[u]["name"], "avatar": names[u]["avatar_at"], "sec": round(v)}
                    for u, v in sorted(users.items(), key=lambda x: -x[1])[:10] if u in names],
    }
    TOP_CACHE.update(at=time.time(), data=data)
    return data


def count(conn, sql: str, *args) -> int:
    return conn.execute(sql, args).fetchone()[0]


@router.get("/api/admin/overview")
def overview(me: Admin):
    from .together import ROOMS

    t = int(time.time())
    day, week = t - 86400, t - 7 * 86400
    with db.tx() as conn:
        users = {
            "total": count(conn, "SELECT COUNT(*) FROM users"),
            "today": count(conn, "SELECT COUNT(*) FROM users WHERE created >= ?", day),
            "week": count(conn, "SELECT COUNT(*) FROM users WHERE created >= ?", week),
            "active_day": count(conn, "SELECT COUNT(DISTINCT user_id) FROM sessions WHERE last_used >= ?", day),
            "active_week": count(conn, "SELECT COUNT(DISTINCT user_id) FROM sessions WHERE last_used >= ?", week),
            "banned": count(conn, "SELECT COUNT(*) FROM users WHERE banned = 1"),
        }
        listening = conn.execute(
            "SELECT u.id, u.login, u.name, u.avatar_at, n.track, n.playing, n.pos, n.at FROM nowplaying n JOIN users u ON u.id = n.user_id "
            "WHERE n.at >= ? ORDER BY n.at DESC LIMIT 50",
            ((t - LIVE_FOR) * 1000,),
        ).fetchall()
        stats = {
            "sessions": count(conn, "SELECT COUNT(*) FROM sessions"),
            "friendships": count(conn, "SELECT COUNT(*) FROM friends") // 2,
            "requests": count(conn, "SELECT COUNT(*) FROM friend_requests"),
            "messages": count(conn, "SELECT COUNT(*) FROM messages"),
            "messages_day": count(conn, "SELECT COUNT(*) FROM messages WHERE created >= ?", day),
            "shares": count(conn, "SELECT COUNT(*) FROM shares"),
        }
        people = {r["id"]: r for r in conn.execute("SELECT id, login, name, avatar_at FROM users")} if ROOMS else {}
        series = {
            "users": per_day(conn, "SELECT created FROM users WHERE created >= ?", t - 29 * 86400, 30),
            "messages": per_day(conn, "SELECT created FROM messages WHERE created >= ?", t - 29 * 86400, 30),
        }
        top = global_top(conn)
    online = []
    for r in listening:
        tr = json.loads(r["track"])
        online.append({"id": r["id"], "login": r["login"], "name": r["name"], "avatar": r["avatar_at"], "playing": bool(r["playing"]),
                       "pos": r["pos"], "at": r["at"], "track": tr})

    def member(m) -> dict:
        p = people.get(m.user_id)
        return {"id": m.user_id, "name": p["name"] if p else m.name, "avatar": p["avatar_at"] if p else 0}

    rooms = [{"code": room.code, "members": [member(m) for m in room.members.values()],
              "track": (room.state or {}).get("track") or None, "playing": bool((room.state or {}).get("playing"))}
             for room in ROOMS.values()]
    size = db.DB_PATH.stat().st_size if db.DB_PATH.exists() else 0
    return {"users": users, "online": online, "rooms": rooms, "stats": stats, "db_size": size, "now": t,
            "now_ms": int(time.time() * 1000), "series": series, "top": top, "uptime": t - STARTED}


@router.get("/api/admin/users")
def users(me: Admin, q: str = "", limit: int = 100):
    like = f"%{q.strip().lower()}%"
    with db.tx() as conn:
        rows = conn.execute(
            "SELECT u.id, u.login, u.name, u.created, u.banned, u.avatar_at, "
            "(SELECT MAX(last_used) FROM sessions s WHERE s.user_id = u.id) AS last_seen, "
            "(SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS sessions, "
            "(SELECT COUNT(*) FROM friends f WHERE f.user_id = u.id) AS friends "
            "FROM users u WHERE lower(u.login) LIKE ? OR lower(u.name) LIKE ? "
            "ORDER BY COALESCE(last_seen, u.created) DESC LIMIT ?",
            (like, like, max(1, min(limit, 500))),
        ).fetchall()
    return {"users": [dict(r) | {"banned": bool(r["banned"]), "admin": is_admin(r["login"])} for r in rows]}


def target(conn, user_id: int, me: Auth):
    row = conn.execute("SELECT id, login FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Нет такого пользователя")
    return row


@router.post("/api/admin/users/{user_id}/logout")
def kick(user_id: int, me: Admin):
    with db.tx() as conn:
        target(conn, user_id, me)
        n = conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,)).rowcount
    return {"closed": n}


@router.post("/api/admin/users/{user_id}/ban")
def ban(user_id: int, body: Ban, me: Admin):
    with db.tx() as conn:
        row = target(conn, user_id, me)
        if body.banned and (user_id == me.user_id or is_admin(row["login"])):
            raise HTTPException(400, "Админа заблокировать нельзя")
        conn.execute("UPDATE users SET banned = ? WHERE id = ?", (int(body.banned), user_id))
        if body.banned:
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM nowplaying WHERE user_id = ?", (user_id,))
    return {"ok": True}


@router.post("/api/admin/users/{user_id}/rename")
def rename(user_id: int, body: Rename, me: Admin):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Имя не может быть пустым")
    with db.tx() as conn:
        target(conn, user_id, me)
        conn.execute("UPDATE users SET name = ? WHERE id = ?", (name, user_id))
    return {"ok": True}


@router.put("/api/admin/announce")
def announce_put(body: Announce, me: Admin):
    text = body.text.strip()
    with db.tx() as conn:
        if text:
            value = json.dumps({"id": int(time.time() * 1000), "text": text, "track": body.track}, ensure_ascii=False)
            conn.execute("INSERT INTO settings (key, value) VALUES ('announce', ?) "
                         "ON CONFLICT (key) DO UPDATE SET value = excluded.value", (value,))
        else:
            conn.execute("DELETE FROM settings WHERE key = 'announce'")
    return {"ok": True}


@router.post("/api/admin/users/{user_id}/notify")
def notify(user_id: int, body: Notify, me: Admin):
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "Пустое уведомление")
    with db.tx() as conn:
        target(conn, user_id, me)
        by = conn.execute("SELECT name FROM users WHERE id = ?", (me.user_id,)).fetchone()["name"]
        value = json.dumps({"id": int(time.time() * 1000), "text": text, "by": by}, ensure_ascii=False)
        conn.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                     (f"notice:{user_id}", value))
    return {"ok": True}


@router.get("/api/announce")
def announce_get(me: Me):
    with db.tx() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = 'announce'").fetchone()
        mine = conn.execute("SELECT value FROM settings WHERE key = ?", (f"notice:{me.user_id}",)).fetchone()
    return {"announce": json.loads(row["value"]) if row else None, "notice": json.loads(mine["value"]) if mine else None}
