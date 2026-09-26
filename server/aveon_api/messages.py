"""Сообщения между друзьями: текст и треки.

Трек в сообщении — тот же снимок, что уходит в «Слушать вместе»: без путей к файлам. Друг включает
его у себя через свой сервис или найденный аналог. Писать можно только друзьям.

  GET   /api/messages/{id}?before=<msg id>  → {messages}   последние 50 (или до before), входящие отмечаются прочитанными
  POST  /api/messages/{id}  {text?, track?, album?} → {message}
  PATCH /api/messages/{id}/{msg}  {text}         → {message}   изменить своё сообщение
  POST  /api/messages/{id}/{msg}/react  {e}      → {message}   своя реакция: та же ещё раз или null — снять

Альбом в сообщении — {code, title, count, cover}: код из «поделиться» (share.py), друг открывает по нему копию.
Реакции в сообщении — [{e, users: [id…]}].

Сколько непрочитанного от каждого друга — в GET /api/friends (unread, last).
"""
from __future__ import annotations

import json
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import db
from .app import Me
from .friends import are_friends

router = APIRouter()

PAGE = 50
MAX_TEXT = 2000
MAX_TRACK = 16 * 1024


MAX_ALBUM = 2 * 1024
REACTIONS = {"❤️", "🔥", "😂", "😍", "👍", "👏", "😢", "💀"}


class MessageIn(BaseModel):
    text: str = Field(default="", max_length=MAX_TEXT)
    track: dict[str, Any] | None = None
    album: dict[str, Any] | None = None


class Edit(BaseModel):
    text: str = Field(max_length=MAX_TEXT)


class React(BaseModel):
    e: str | None = None


def reactions_for(conn, ids: list[int]) -> dict[int, list[dict]]:
    out: dict[int, dict[str, list[int]]] = {}
    if ids:
        for r in conn.execute(
            f"SELECT msg_id, user_id, e FROM message_reactions WHERE msg_id IN ({','.join('?' * len(ids))}) ORDER BY at, rowid",
            ids,
        ):
            out.setdefault(r["msg_id"], {}).setdefault(r["e"], []).append(r["user_id"])
    return {m: [{"e": e, "users": u} for e, u in by.items()] for m, by in out.items()}


def message_view(r, me: int, reactions: dict | None = None) -> dict:
    return {
        "id": r["id"], "mine": r["from_id"] == me, "text": r["text"],
        "track": json.loads(r["track"]) if r["track"] else None,
        "album": json.loads(r["album"]) if r["album"] else None,
        "created": r["created"], "read": bool(r["read"]), "edited": r["edited"],
        "reactions": (reactions or {}).get(r["id"], []),
        "my": next((x["e"] for x in (reactions or {}).get(r["id"], []) if me in x["users"]), None),  # моя реакция
    }


def own_pair(conn, me: int, user_id: int, msg_id: int):
    """Сообщение из переписки со мной и этим другом, иначе 404."""
    row = conn.execute(
        "SELECT * FROM messages WHERE id = ? AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))",
        (msg_id, me, user_id, user_id, me),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Такого сообщения нет")
    return row


def unread_by_friend(conn, user_id: int) -> dict[int, dict]:
    """от кого → {unread, last: {id, text, track_title}} по непрочитанным входящим"""
    rows = conn.execute(
        "SELECT m.from_id, m.id, m.text, m.track, c.n FROM messages m JOIN "
        "(SELECT from_id, COUNT(*) AS n, MAX(id) AS last FROM messages WHERE to_id = ? AND read = 0 GROUP BY from_id) c "
        "ON m.id = c.last",
        (user_id,),
    ).fetchall()
    out = {}
    for r in rows:
        title = json.loads(r["track"]).get("title", "") if r["track"] else ""
        out[r["from_id"]] = {"unread": r["n"], "last": {"id": r["id"], "text": r["text"], "track_title": title}}
    return out


@router.get("/api/messages/{user_id}")
def messages_get(user_id: int, me: Me, before: int | None = None):
    with db.tx() as conn:
        if not are_friends(conn, me.user_id, user_id):
            raise HTTPException(403, "Переписываться можно только с друзьями")
        rows = conn.execute(
            "SELECT * FROM messages WHERE ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)) "
            "AND id < ? ORDER BY id DESC LIMIT ?",
            (me.user_id, user_id, user_id, me.user_id, before or 2**62, PAGE),
        ).fetchall()
        conn.execute("UPDATE messages SET read = 1 WHERE from_id = ? AND to_id = ? AND read = 0", (user_id, me.user_id))
        reacts = reactions_for(conn, [r["id"] for r in rows])
    return {"messages": [message_view(r, me.user_id, reacts) for r in reversed(rows)]}


@router.post("/api/messages/{user_id}")
def messages_send(user_id: int, body: MessageIn, me: Me):
    text = body.text.strip()
    track = None
    if body.track is not None:
        track = json.dumps(body.track, ensure_ascii=False, separators=(",", ":"))
        if len(track.encode()) > MAX_TRACK or not str(body.track.get("title") or "").strip():
            raise HTTPException(400, "Неверный трек")
    album = None
    if body.album is not None:
        from .share import CODE_RE, norm_code  # share.py импортирует app, messages — тоже; здесь без круга
        a = body.album
        code = norm_code(str(a.get("code") or ""))
        if not CODE_RE.match(code) or not str(a.get("title") or "").strip():
            raise HTTPException(400, "Неверный альбом")
        album = json.dumps({"code": code, "title": str(a["title"])[:120], "count": int(a.get("count") or 0),
                            "cover": str(a.get("cover") or "")[:500]}, ensure_ascii=False, separators=(",", ":"))
        if len(album.encode()) > MAX_ALBUM:
            raise HTTPException(413, "Неверный альбом")
    if not text and not track and not album:
        raise HTTPException(400, "Пустое сообщение")
    with db.tx() as conn:
        if not are_friends(conn, me.user_id, user_id):
            raise HTTPException(403, "Писать можно только друзьям")
        cur = conn.execute(
            "INSERT INTO messages (from_id, to_id, text, track, album, created, read) VALUES (?, ?, ?, ?, ?, ?, 0)",
            (me.user_id, user_id, text, track, album, int(time.time())),
        )
        row = conn.execute("SELECT * FROM messages WHERE id = ?", (cur.lastrowid,)).fetchone()
    return {"message": message_view(row, me.user_id)}


@router.patch("/api/messages/{user_id}/{msg_id}")
def messages_edit(user_id: int, msg_id: int, body: Edit, me: Me):
    text = body.text.strip()
    with db.tx() as conn:
        row = own_pair(conn, me.user_id, user_id, msg_id)
        if row["from_id"] != me.user_id:
            raise HTTPException(403, "Изменить можно только своё сообщение")
        if not text and not row["track"] and not row["album"]:
            raise HTTPException(400, "Пустое сообщение")
        conn.execute("UPDATE messages SET text = ?, edited = ? WHERE id = ?", (text, int(time.time()), msg_id))
        row = conn.execute("SELECT * FROM messages WHERE id = ?", (msg_id,)).fetchone()
        return {"message": message_view(row, me.user_id, reactions_for(conn, [msg_id]))}


@router.post("/api/messages/{user_id}/{msg_id}/react")
def messages_react(user_id: int, msg_id: int, body: React, me: Me):
    if body.e is not None and body.e not in REACTIONS:
        raise HTTPException(400, "Такой реакции нет")
    with db.tx() as conn:
        own_pair(conn, me.user_id, user_id, msg_id)
        was = conn.execute("SELECT e FROM message_reactions WHERE msg_id = ? AND user_id = ?", (msg_id, me.user_id)).fetchone()
        conn.execute("DELETE FROM message_reactions WHERE msg_id = ? AND user_id = ?", (msg_id, me.user_id))
        if body.e and (not was or was["e"] != body.e):  # та же ещё раз — снять
            conn.execute("INSERT INTO message_reactions (msg_id, user_id, e, at) VALUES (?, ?, ?, ?)",
                         (msg_id, me.user_id, body.e, int(time.time())))
        row = conn.execute("SELECT * FROM messages WHERE id = ?", (msg_id,)).fetchone()
        return {"message": message_view(row, me.user_id, reactions_for(conn, [msg_id]))}
