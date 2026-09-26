"""Админка: только для логинов из AVEON_ADMINS (по умолчанию xvoidead, htdealwme).

  GET  /api/admin/overview                 → сводка: пользователи, кто онлайн и что слушает, румы, сообщения
  GET  /api/admin/users?q=&limit=          → пользователи (поиск по логину и имени)
  POST /api/admin/users/{id}/logout        → закрыть все его сессии
  POST /api/admin/users/{id}/ban {banned}  → заблокировать (и выкинуть отовсюду) / разблокировать
  POST /api/admin/users/{id}/rename {name} → сменить имя (например, за оскорбительное)
  PUT  /api/admin/announce {text}          → объявление всем; пустой текст — убрать
  GET  /api/announce                       → текущее объявление (для всех вошедших)
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
            "SELECT u.id, u.login, u.name, n.track, n.playing, n.at FROM nowplaying n JOIN users u ON u.id = n.user_id "
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
        names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM users")} if ROOMS else {}
    online = []
    for r in listening:
        tr = json.loads(r["track"])
        online.append({"id": r["id"], "login": r["login"], "name": r["name"], "playing": bool(r["playing"]),
                       "title": tr.get("title", ""), "artist": tr.get("artist", ""), "source": tr.get("source", "")})
    rooms = [{"code": room.code, "members": [names.get(m.user_id, m.name) for m in room.members.values()],
              "track": (room.state or {}).get("track", {}).get("title", "")} for room in ROOMS.values()]
    size = db.DB_PATH.stat().st_size if db.DB_PATH.exists() else 0
    return {"users": users, "online": online, "rooms": rooms, "stats": stats, "db_size": size, "now": t}


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
            value = json.dumps({"id": int(time.time() * 1000), "text": text}, ensure_ascii=False)
            conn.execute("INSERT INTO settings (key, value) VALUES ('announce', ?) "
                         "ON CONFLICT (key) DO UPDATE SET value = excluded.value", (value,))
        else:
            conn.execute("DELETE FROM settings WHERE key = 'announce'")
    return {"ok": True}


@router.get("/api/announce")
def announce_get(me: Me):
    with db.tx() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = 'announce'").fetchone()
    return {"announce": json.loads(row["value"]) if row else None}
