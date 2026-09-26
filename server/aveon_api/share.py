"""Поделиться альбомом или пресетом эквалайзера: короткий код вместо простыни текста.

Плеер кладёт снимок (название, треки или полосы) и получает код вида AB3D-7KQM. Друг вводит
код у себя и получает копию снимка. Снимок не меняется: правки после отправки другу не видны.

  POST /api/share        {kind, data}  → {code}
  GET  /api/share/{code}               → {kind, data, by, created}
"""
from __future__ import annotations

import json
import re
import secrets
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import db
from .app import Me

router = APIRouter()

KINDS = {"album", "eq"}
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
