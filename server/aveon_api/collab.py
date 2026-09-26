"""Совместные плейлисты: несколько человек добавляют треки по коду. В отличие от «поделиться» (share.py)
плейлист живой — правки видны всем участникам. Клиент опрашивает GET /api/collab/{code} раз в 15 с,
пока плейлист открыт, и перерисовывает список, когда меняется rev.

  POST  /api/collab                 {title, tracks}  → {code}            создатель сразу участник
  GET   /api/collab                                  → [{code, title, count, members, updated, rev}]  где я участник
  GET   /api/collab/{code}                           → {code, title, owner, rev, updated, members, tracks}
  POST  /api/collab/{code}/join                      → то же, что GET
  POST  /api/collab/{code}/tracks   {tracks}         → {rev}   в конец, дубликаты по id пропускаются
  POST  /api/collab/{code}/remove   {ids}            → {rev}   удалить может тот, кто добавил, или владелец
  POST  /api/collab/{code}/move     {id, before}     → {rev}   before — id трека или null (в конец)
  PATCH /api/collab/{code}          {title}          → {rev}   только владелец
  POST  /api/collab/{code}/leave                     → {}      ушёл владелец — плейлист самому раннему участнику;
                                                                участников нет — плейлист удаляется
"""
from __future__ import annotations

import json
import secrets
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import db
from .app import Me
from .share import CODE_ALPHABET, CODE_LEN, CODE_RE, norm_code

router = APIRouter()

MAX_MEMBERS = 20
MAX_TRACKS = 2000
MAX_TRACK = 8 * 1024  # JSON снимка одного трека
NOT_FOUND = "Такого плейлиста нет. Проверь код"


class Create(BaseModel):
    title: str = Field(max_length=100)
    tracks: list[dict[str, Any]] = Field(default_factory=list)


class Tracks(BaseModel):
    tracks: list[dict[str, Any]]


class Remove(BaseModel):
    ids: list[str]


class Move(BaseModel):
    id: str
    before: str | None = None


class Title(BaseModel):
    title: str = Field(max_length=100)


def now() -> int:
    return int(time.time())


def clean_title(title: str) -> str:
    title = title.strip()
    if not title:
        raise HTTPException(400, "Назови плейлист")
    return title


def snapshots(tracks: list[dict]) -> list[tuple[str, str]]:
    """[(track_id, JSON)] — проверяем каждый трек: есть id и название, снимок не больше 8 КБ."""
    out = []
    for t in tracks:
        tid = str(t.get("id") or "").strip()
        if not tid or not str(t.get("title") or "").strip():
            raise HTTPException(400, "У трека нет id или названия")
        data = json.dumps(t, ensure_ascii=False, separators=(",", ":"))
        if len(data.encode()) > MAX_TRACK:
            raise HTTPException(413, f"Трек «{t.get('title')}» слишком большой")
        out.append((tid, data))
    return out


def find(conn, code: str):
    code = norm_code(code)
    row = conn.execute("SELECT * FROM collabs WHERE code = ?", (code,)).fetchone() if CODE_RE.match(code) else None
    if not row:
        raise HTTPException(404, NOT_FOUND)
    return row


def member_of(conn, code: str, user_id: int) -> bool:
    return bool(conn.execute("SELECT 1 FROM collab_members WHERE code = ? AND user_id = ?", (code, user_id)).fetchone())


def must_member(conn, code: str, user_id: int) -> None:
    if not member_of(conn, code, user_id):
        raise HTTPException(403, "Ты не в этом плейлисте — войди по коду")


def bump(conn, code: str) -> int:
    conn.execute("UPDATE collabs SET rev = rev + 1, updated = ? WHERE code = ?", (now(), code))
    return conn.execute("SELECT rev FROM collabs WHERE code = ?", (code,)).fetchone()["rev"]


def add_tracks(conn, code: str, user_id: int, tracks: list[dict]) -> int:
    """Добавить в конец, пропуская уже имеющиеся. Возвращает, сколько добавлено."""
    snaps = snapshots(tracks)
    have = {r["track_id"] for r in conn.execute("SELECT track_id FROM collab_tracks WHERE code = ?", (code,))}
    fresh, seen = [], set()
    for tid, data in snaps:
        if tid in have or tid in seen:
            continue
        seen.add(tid)
        fresh.append((tid, data))
    if len(have) + len(fresh) > MAX_TRACKS:
        raise HTTPException(400, f"В плейлисте может быть не больше {MAX_TRACKS} треков")
    top = conn.execute("SELECT COALESCE(MAX(pos), 0) FROM collab_tracks WHERE code = ?", (code,)).fetchone()[0]
    t = now()
    conn.executemany(
        "INSERT INTO collab_tracks (code, track_id, data, added_by, added_at, pos) VALUES (?, ?, ?, ?, ?, ?)",
        [(code, tid, data, user_id, t, top + i + 1) for i, (tid, data) in enumerate(fresh)],
    )
    return len(fresh)


def view(conn, row) -> dict:
    code = row["code"]
    members = conn.execute(
        "SELECT u.id, u.name, u.avatar_at FROM collab_members m JOIN users u ON u.id = m.user_id "
        "WHERE m.code = ? ORDER BY m.joined, u.id",
        (code,),
    ).fetchall()
    tracks = conn.execute(
        "SELECT t.data, t.added_at, u.id AS by_id, u.name AS by_name FROM collab_tracks t "
        "JOIN users u ON u.id = t.added_by WHERE t.code = ? ORDER BY t.pos",
        (code,),
    ).fetchall()
    return {
        "code": code, "title": row["title"], "owner": row["owner_id"], "rev": row["rev"], "updated": row["updated"],
        "members": [dict(m) for m in members],
        "tracks": [json.loads(t["data"]) | {"by": {"id": t["by_id"], "name": t["by_name"]}, "added_at": t["added_at"]}
                   for t in tracks],
    }


@router.post("/api/collab")
def create(body: Create, me: Me):
    title = clean_title(body.title)
    with db.tx() as conn:
        for _ in range(10):
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LEN))
            if not conn.execute("SELECT 1 FROM collabs WHERE code = ?", (code,)).fetchone():
                break
        t = now()
        conn.execute(
            "INSERT INTO collabs (code, owner_id, title, rev, created, updated) VALUES (?, ?, ?, 1, ?, ?)",
            (code, me.user_id, title, t, t),
        )
        conn.execute("INSERT INTO collab_members (code, user_id, joined) VALUES (?, ?, ?)", (code, me.user_id, t))
        add_tracks(conn, code, me.user_id, body.tracks)
    return {"code": code}


@router.get("/api/collab")
def mine(me: Me):
    with db.tx() as conn:
        rows = conn.execute(
            "SELECT c.code, c.title, c.updated, c.rev, "
            "(SELECT COUNT(*) FROM collab_tracks t WHERE t.code = c.code) AS count, "
            "(SELECT COUNT(*) FROM collab_members x WHERE x.code = c.code) AS members "
            "FROM collabs c JOIN collab_members m ON m.code = c.code AND m.user_id = ? ORDER BY c.updated DESC",
            (me.user_id,),
        ).fetchall()
    return [dict(r) for r in rows]


@router.get("/api/collab/{code}")
def get(code: str, me: Me):
    with db.tx() as conn:
        row = find(conn, code)
        must_member(conn, row["code"], me.user_id)
        return view(conn, row)


@router.post("/api/collab/{code}/join")
def join(code: str, me: Me):
    with db.tx() as conn:
        row = find(conn, code)
        if not member_of(conn, row["code"], me.user_id):
            if conn.execute("SELECT COUNT(*) FROM collab_members WHERE code = ?", (row["code"],)).fetchone()[0] >= MAX_MEMBERS:
                raise HTTPException(400, f"В плейлисте уже {MAX_MEMBERS} участников")
            conn.execute("INSERT INTO collab_members (code, user_id, joined) VALUES (?, ?, ?)", (row["code"], me.user_id, now()))
            bump(conn, row["code"])
            row = find(conn, row["code"])
        return view(conn, row)


@router.post("/api/collab/{code}/tracks")
def tracks_add(code: str, body: Tracks, me: Me):
    with db.tx() as conn:
        row = find(conn, code)
        must_member(conn, row["code"], me.user_id)
        added = add_tracks(conn, row["code"], me.user_id, body.tracks)
        return {"rev": bump(conn, row["code"]) if added else row["rev"]}


@router.post("/api/collab/{code}/remove")
def tracks_remove(code: str, body: Remove, me: Me):
    with db.tx() as conn:
        row = find(conn, code)
        must_member(conn, row["code"], me.user_id)
        owner = row["owner_id"] == me.user_id
        found = conn.execute(
            f"SELECT track_id, added_by FROM collab_tracks WHERE code = ? AND track_id IN ({','.join('?' * len(body.ids))})",
            (row["code"], *body.ids),
        ).fetchall() if body.ids else []
        allowed = [r["track_id"] for r in found if owner or r["added_by"] == me.user_id]
        if found and not allowed:
            raise HTTPException(403, "Убрать трек может тот, кто его добавил, или владелец плейлиста")
        if not allowed:
            return {"rev": row["rev"]}
        conn.execute(
            f"DELETE FROM collab_tracks WHERE code = ? AND track_id IN ({','.join('?' * len(allowed))})",
            (row["code"], *allowed),
        )
        return {"rev": bump(conn, row["code"])}


@router.post("/api/collab/{code}/move")
def move(code: str, body: Move, me: Me):
    with db.tx() as conn:
        row = find(conn, code)
        c = row["code"]
        must_member(conn, c, me.user_id)
        order = [r["track_id"] for r in conn.execute("SELECT track_id FROM collab_tracks WHERE code = ? ORDER BY pos", (c,))]
        if body.id not in order or (body.before is not None and body.before not in order):
            raise HTTPException(404, "Такого трека в плейлисте нет")
        if body.id == body.before:
            return {"rev": row["rev"]}
        order.remove(body.id)
        order.insert(order.index(body.before) if body.before is not None else len(order), body.id)
        # позиции заново 1..n: плейлист до 2000 треков, дробные зазоры копить незачем
        conn.executemany("UPDATE collab_tracks SET pos = ? WHERE code = ? AND track_id = ?",
                         [(i + 1, c, tid) for i, tid in enumerate(order)])
        return {"rev": bump(conn, c)}


@router.patch("/api/collab/{code}")
def rename(code: str, body: Title, me: Me):
    with db.tx() as conn:
        row = find(conn, code)
        if row["owner_id"] != me.user_id:
            raise HTTPException(403, "Переименовать может только владелец")
        conn.execute("UPDATE collabs SET title = ? WHERE code = ?", (clean_title(body.title), row["code"]))
        return {"rev": bump(conn, row["code"])}


@router.post("/api/collab/{code}/leave")
def leave(code: str, me: Me):
    with db.tx() as conn:
        row = find(conn, code)
        c = row["code"]
        must_member(conn, c, me.user_id)
        conn.execute("DELETE FROM collab_members WHERE code = ? AND user_id = ?", (c, me.user_id))
        heir = conn.execute("SELECT user_id FROM collab_members WHERE code = ? ORDER BY joined, user_id LIMIT 1", (c,)).fetchone()
        if not heir:
            conn.execute("DELETE FROM collabs WHERE code = ?", (c,))  # треки и участники — каскадом
            return {}
        if row["owner_id"] == me.user_id:
            conn.execute("UPDATE collabs SET owner_id = ? WHERE code = ?", (heir["user_id"], c))
        bump(conn, c)
    return {}
