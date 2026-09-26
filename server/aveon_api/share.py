"""Поделиться альбомом или пресетом эквалайзера: короткий код вместо простыни текста.

Плеер кладёт снимок (название, треки или полосы) и получает код вида AB3D-7KQM. Друг вводит
код у себя и получает копию снимка. Снимок не меняется: правки после отправки другу не видны.

  POST /api/share        {kind, data}  → {code}
  GET  /api/share/{code}               → {kind, data, by, created}

Трек (kind "track", data {track, room?}) можно открыть и без аккаунта — ссылкой https://{сервер}/t/{code}:
  GET  /api/share/{code}/public        → {kind, data, by, created}   только для kind == "track"
  GET  /t/{code}                       → HTML-страница; Discord берёт из её <head> превью (og:…)
room — код румы, если человек слушает вместе: друг по ссылке сразу зайдёт к нему.
"""
from __future__ import annotations

import json
import re
import secrets
import time
from typing import Any

import html

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from . import db
from .app import Me

router = APIRouter()

KINDS = {"album", "eq", "track"}
MAX_TRACK_SHARE = 16 * 1024  # трек — снимок и код румы, не больше 16 КБ
MAX_SHARE = 1024 * 1024  # один снимок — до 1 МБ (альбом на пару тысяч треков)
MAX_PER_USER = 500  # старые коды удаляются, когда их больше
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # без 0/O и 1/I — код легко продиктовать
CODE_LEN = 8
CODE_RE = re.compile(rf"^[{CODE_ALPHABET}]{{{CODE_LEN}}}$")


class SharePut(BaseModel):
    kind: str
    data: Any


def norm_code(code: str) -> str:
    return re.sub(r"[\s-]", "", code).upper()


@router.post("/api/share")
def share_put(body: SharePut, me: Me):
    if body.kind not in KINDS:
        raise HTTPException(400, "Этим нельзя поделиться")
    data = json.dumps(body.data, ensure_ascii=False, separators=(",", ":"))
    if len(data.encode()) > MAX_SHARE:
        raise HTTPException(413, "Слишком большой альбом, чтобы поделиться")
    if body.kind == "track":
        t = body.data.get("track") if isinstance(body.data, dict) else None
        if not isinstance(t, dict) or not str(t.get("title") or "").strip():
            raise HTTPException(400, "Нет трека")
        if len(data.encode()) > MAX_TRACK_SHARE:
            raise HTTPException(413, "Слишком большой трек, чтобы поделиться")
    with db.tx() as conn:
        for _ in range(10):
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LEN))
            if not conn.execute("SELECT 1 FROM shares WHERE code = ?", (code,)).fetchone():
                break
        conn.execute(
            "INSERT INTO shares (code, user_id, kind, data, created) VALUES (?, ?, ?, ?, ?)",
            (code, me.user_id, body.kind, data, int(time.time())),
        )
        conn.execute(
            "DELETE FROM shares WHERE user_id = ? AND code NOT IN "
            "(SELECT code FROM shares WHERE user_id = ? ORDER BY created DESC, rowid DESC LIMIT ?)",
            (me.user_id, me.user_id, MAX_PER_USER),
        )
    return {"code": code}


@router.get("/api/share/{code}")
def share_get(code: str, me: Me):
    code = norm_code(code)
    if not CODE_RE.match(code):
        raise HTTPException(404, "Такого кода нет")
    with db.tx() as conn:
        row = conn.execute(
            "SELECT s.kind, s.data, s.created, u.name FROM shares s JOIN users u ON u.id = s.user_id WHERE s.code = ?",
            (code,),
        ).fetchone()
    if not row:
        raise HTTPException(404, "Такого кода нет. Проверь буквы или попроси прислать заново")
    return {"kind": row["kind"], "data": json.loads(row["data"]), "by": row["name"], "created": row["created"]}


# ---------- трек по ссылке: без аккаунта ----------

def public_track(code: str):
    code = norm_code(code)
    if not CODE_RE.match(code):
        return None
    with db.tx() as conn:
        return conn.execute(
            "SELECT s.code, s.kind, s.data, s.created, u.name FROM shares s JOIN users u ON u.id = s.user_id "
            "WHERE s.code = ? AND s.kind = 'track'",
            (code,),
        ).fetchone()


@router.get("/api/share/{code}/public")
def share_public(code: str):
    row = public_track(code)
    if not row:
        raise HTTPException(404, "Такого трека нет. Попроси прислать ссылку заново")
    return {"kind": row["kind"], "data": json.loads(row["data"]), "by": row["name"], "created": row["created"]}


SOURCE_NAMES = {"ym": "Яндекс Музыке", "sc": "SoundCloud", "sp": "Spotify"}

PAGE = """<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — авеон</title>
<meta property="og:type" content="music.song">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
{image}<meta property="og:site_name" content="авеон">
<meta name="theme-color" content="#f0a63a">
<meta name="twitter:card" content="summary_large_image">
<style>
  :root {{ color-scheme: dark; }}
  body {{ margin: 0; min-height: 100vh; display: grid; place-items: center; background: #1b1411; color: #f1e6d6;
         font: 16px/1.5 "Segoe UI", system-ui, sans-serif; }}
  main {{ width: min(360px, calc(100vw - 32px)); text-align: center; }}
  img, .none {{ width: 100%; aspect-ratio: 1; border-radius: 20px; object-fit: cover; box-shadow: 0 24px 60px rgb(0 0 0 / .5); background: #2a201b; }}
  .none {{ display: grid; place-items: center; font-size: 64px; color: #8a7a68; }}
  h1 {{ margin: 22px 0 2px; font-size: 22px; }}
  p {{ margin: 0; color: #bfae99; }}
  small {{ display: block; margin-top: 10px; color: #8a7a68; }}
  a {{ display: block; margin-top: 12px; padding: 13px; border-radius: 99px; text-decoration: none; font-weight: 600; }}
  .go {{ margin-top: 24px; background: #f0a63a; color: #1b1411; }}
  .alt {{ background: #33271f; color: #f1e6d6; }}
</style></head>
<body><main>
{cover}
<h1>{name}</h1><p>{artist}</p>{by}
<a class="go" href="aveon://track/{code}">Открыть в авеоне</a>
{link}
</main></body></html>"""


@router.get("/t/{code}", response_class=HTMLResponse)
def track_page(code: str):
    row = public_track(code)
    if not row:
        return HTMLResponse(PAGE.format(title="Трек не найден", desc="Ссылка устарела или в ней опечатка", image="",
                                        cover='<div class="none">♪</div>', name="Трек не найден",
                                        artist="Попроси прислать ссылку заново", by="", code="", link=""), status_code=404)
    data = json.loads(row["data"])
    t = data.get("track") or {}
    e = lambda v: html.escape(str(v or ""), quote=True)
    title, artist = str(t.get("title") or ""), str(t.get("artist") or "")
    cover = str(t.get("cover") or "")
    cover = cover if cover.startswith("https://") else ""
    link = str(t.get("link") or "")
    link = link if link.startswith(("https://", "http://")) else ""
    desc = "Слушать в авеоне" + (f", вместе с {row['name']}" if data.get("room") else "")
    return PAGE.format(
        title=e(f"{title} — {artist}" if artist else title),
        desc=e(desc),
        image=f'<meta property="og:image" content="{e(cover)}">\n' if cover else "",
        cover=f'<img src="{e(cover)}" alt="">' if cover else '<div class="none">♪</div>',
        name=e(title), artist=e(artist),
        by=f"<small>от {e(row['name'])}{' · слушают вместе' if data.get('room') else ''}</small>",
        code=e(row["code"]),
        link=f'<a class="alt" href="{e(link)}">Открыть в {e(SOURCE_NAMES.get(t.get("source"), "сервисе"))}</a>' if link else "",
    )
