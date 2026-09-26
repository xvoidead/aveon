"""Сообщения между друзьями: текст и треки.

Трек в сообщении — тот же снимок, что уходит в «Слушать вместе»: без путей к файлам. Друг включает
его у себя через свой сервис или найденный аналог. Писать можно только друзьям.

  GET  /api/messages/{id}?before=<msg id>  → {messages}   последние 50 (или до before), входящие отмечаются прочитанными
  POST /api/messages/{id}  {text?, track?} → {message}

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


class MessageIn(BaseModel):
    text: str = Field(default="", max_length=MAX_TEXT)
    track: dict[str, Any] | None = None


def message_view(r, me: int) -> dict:
    return {
        "id": r["id"], "mine": r["from_id"] == me, "text": r["text"],
        "track": json.loads(r["track"]) if r["track"] else None,
        "created": r["created"], "read": bool(r["read"]),
    }


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
    return {"messages": [message_view(r, me.user_id) for r in reversed(rows)]}


@router.post("/api/messages/{user_id}")
def messages_send(user_id: int, body: MessageIn, me: Me):
    text = body.text.strip()
    track = None
    if body.track is not None:
        track = json.dumps(body.track, ensure_ascii=False, separators=(",", ":"))
        if len(track.encode()) > MAX_TRACK or not str(body.track.get("title") or "").strip():
            raise HTTPException(400, "Неверный трек")
    if not text and not track:
        raise HTTPException(400, "Пустое сообщение")
    with db.tx() as conn:
        if not are_friends(conn, me.user_id, user_id):
            raise HTTPException(403, "Писать можно только друзьям")
        cur = conn.execute(
            "INSERT INTO messages (from_id, to_id, text, track, created, read) VALUES (?, ?, ?, ?, ?, 0)",
            (me.user_id, user_id, text, track, int(time.time())),
        )
        row = conn.execute("SELECT * FROM messages WHERE id = ?", (cur.lastrowid,)).fetchone()
    return {"message": message_view(row, me.user_id)}
