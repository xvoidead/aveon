"""API аккаунтов авеона: регистрация, вход и синхронизация альбомов, настроек и статистики.

Отдельно:    python run.py   (см. run.py)
Внутри бота: bot.py поднимает это приложение в том же процессе, что и поллинг.
"""
from __future__ import annotations

import json
import re
import time
from contextlib import asynccontextmanager
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import db, security

SESSION_TTL = 90 * 24 * 3600  # сессия живёт 90 дней с последнего запроса
MAX_DOC = 5 * 1024 * 1024  # один синхронизируемый документ — до 5 МБ
KINDS = {"albums", "settings", "stats"}
LOGIN_RE = re.compile(r"^[a-z0-9_.-]{3,32}$")
KEY_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    yield


app = FastAPI(title="авеон", docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None, lifespan=lifespan)
limiter = security.RateLimit()


# Ошибки в одном виде: {"error": "текст"} — плеер показывает его как есть
@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    body = exc.detail if isinstance(exc.detail, dict) else {"error": exc.detail}
    return JSONResponse(body, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    return JSONResponse({"error": "Неверный формат запроса"}, status_code=422)


def now() -> int:
    return int(time.time())


# ---------- модели ----------

class Register(BaseModel):
    login: str
    password: str = Field(max_length=256)
    name: str = Field(default="", max_length=64)
    device: str = Field(default="", max_length=64)


class Login(BaseModel):
    login: str
    password: str = Field(max_length=256)
    device: str = Field(default="", max_length=64)


class Profile(BaseModel):
    name: str = Field(max_length=64)


class PasswordChange(BaseModel):
    old: str = Field(max_length=256)
    new: str = Field(max_length=256)


class Confirm(BaseModel):
    password: str = Field(max_length=256)


class DocPut(BaseModel):
    data: Any
    base_rev: int | None = None  # ревизия, от которой клиент делал изменения; None — документа ещё нет


# ---------- авторизация ----------

class Auth(BaseModel):
    user_id: int
    session_id: int


def auth(authorization: Annotated[str, Header()] = "") -> Auth:
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(401, "Нужно войти в аккаунт")
    with db.tx() as conn:
        row = conn.execute(
            "SELECT id, user_id, last_used FROM sessions WHERE token_hash = ?",
            (security.token_hash(token),),
        ).fetchone()
        if not row or now() - row["last_used"] > SESSION_TTL:
            if row:
                conn.execute("DELETE FROM sessions WHERE id = ?", (row["id"],))
            raise HTTPException(401, "Сессия истекла, войди заново")
        if now() - row["last_used"] > 60:
            conn.execute("UPDATE sessions SET last_used = ? WHERE id = ?", (now(), row["id"]))
    return Auth(user_id=row["user_id"], session_id=row["id"])


Me = Annotated[Auth, Depends(auth)]

from .together import router as together_router  # noqa: E402 — модулю нужен auth выше

from .share import router as share_router  # noqa: E402

app.include_router(together_router)
app.include_router(share_router)


def user_view(row) -> dict:
    return {"id": row["id"], "login": row["login"], "name": row["name"], "created": row["created"]}


def get_user(conn, user_id: int):
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        raise HTTPException(401, "Аккаунт удалён")
    return row


def start_session(conn, user_id: int, device: str) -> str:
    token = security.new_token()
    conn.execute(
        "INSERT INTO sessions (user_id, token_hash, device, created, last_used) VALUES (?, ?, ?, ?, ?)",
        (user_id, security.token_hash(token), device, now(), now()),
    )
    return token


def check_new_password(pw: str) -> None:
    if len(pw) < 8:
        raise HTTPException(400, "Пароль должен быть не короче 8 символов")


# ---------- эндпоинты ----------

@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/auth/register")
def register(body: Register):
    login = body.login.strip().lower()
    if not LOGIN_RE.match(login):
        raise HTTPException(400, "Логин: 3–32 символа, латиница, цифры, точка, дефис или подчёркивание")
    check_new_password(body.password)
    name = body.name.strip() or login
    with db.tx() as conn:
        if conn.execute("SELECT 1 FROM users WHERE login = ?", (login,)).fetchone():
            raise HTTPException(409, "Такой логин уже занят")
        cur = conn.execute(
            "INSERT INTO users (login, name, pw_hash, created) VALUES (?, ?, ?, ?)",
            (login, name, security.hash_password(body.password), now()),
        )
        token = start_session(conn, cur.lastrowid, body.device)
        user = get_user(conn, cur.lastrowid)
    return {"token": token, "user": user_view(user)}


@app.post("/api/auth/login")
def login(body: Login, request: Request):
    login = body.login.strip().lower()
    ip = request.client.host if request.client else "?"
    keys = (f"ip:{ip}", f"login:{login}")
    if any(limiter.blocked(k) for k in keys):
        raise HTTPException(429, "Слишком много попыток входа, попробуй через 15 минут")
    with db.tx() as conn:
        user = conn.execute("SELECT * FROM users WHERE login = ?", (login,)).fetchone()
        ok = security.check_password(body.password, user["pw_hash"] if user else security.DUMMY_HASH)
        if not user or not ok:
            for k in keys:
                limiter.fail(k)
            raise HTTPException(401, "Неверный логин или пароль")
        limiter.reset(f"login:{login}")
        token = start_session(conn, user["id"], body.device)
    return {"token": token, "user": user_view(user)}


@app.post("/api/auth/logout")
def logout(me: Me):
    with db.tx() as conn:
        conn.execute("DELETE FROM sessions WHERE id = ?", (me.session_id,))
    return {"ok": True}


@app.post("/api/auth/logout-all")
def logout_all(me: Me):
    """Выйти на всех устройствах, кроме текущего."""
    with db.tx() as conn:
        n = conn.execute(
            "DELETE FROM sessions WHERE user_id = ? AND id != ?", (me.user_id, me.session_id)
        ).rowcount
    return {"closed": n}


@app.get("/api/me")
def me_get(me: Me):
    with db.tx() as conn:
        user = get_user(conn, me.user_id)
        devices = conn.execute(
            "SELECT id, device, created, last_used FROM sessions WHERE user_id = ? ORDER BY last_used DESC",
            (me.user_id,),
        ).fetchall()
    return {
        "user": user_view(user),
        "sessions": [dict(d) | {"current": d["id"] == me.session_id} for d in devices],
    }


@app.patch("/api/me")
def me_update(body: Profile, me: Me):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Имя не может быть пустым")
    with db.tx() as conn:
        conn.execute("UPDATE users SET name = ? WHERE id = ?", (name, me.user_id))
        user = get_user(conn, me.user_id)
    return {"user": user_view(user)}


@app.post("/api/me/password")
def me_password(body: PasswordChange, me: Me):
    check_new_password(body.new)
    with db.tx() as conn:
        user = get_user(conn, me.user_id)
        if not security.check_password(body.old, user["pw_hash"]):
            raise HTTPException(403, "Старый пароль не подходит")
        conn.execute("UPDATE users SET pw_hash = ? WHERE id = ?", (security.hash_password(body.new), me.user_id))
        # Сменили пароль — остальные устройства должны войти заново
        conn.execute("DELETE FROM sessions WHERE user_id = ? AND id != ?", (me.user_id, me.session_id))
    return {"ok": True}


@app.post("/api/me/delete")
def me_delete(body: Confirm, me: Me):
    with db.tx() as conn:
        user = get_user(conn, me.user_id)
        if not security.check_password(body.password, user["pw_hash"]):
            raise HTTPException(403, "Пароль не подходит")
        conn.execute("DELETE FROM users WHERE id = ?", (me.user_id,))  # сессии и документы удалятся каскадом
    return {"ok": True}


# ---------- синхронизация ----------

@app.get("/api/sync")
def sync_get(me: Me):
    with db.tx() as conn:
        rows = conn.execute(
            "SELECT kind, key, rev, data, updated FROM docs WHERE user_id = ?", (me.user_id,)
        ).fetchall()
    return {"docs": [dict(r) | {"data": json.loads(r["data"])} for r in rows]}


@app.put("/api/sync/{kind}/{key}")
def sync_put(kind: str, key: str, body: DocPut, me: Me):
    """Записать документ, если он не менялся с base_rev. Иначе 409 и текущая версия сервера —
    клиент сливает её со своей и присылает снова."""
    if kind not in KINDS or not KEY_RE.match(key):
        raise HTTPException(404, "Нет такого документа")
    data = json.dumps(body.data, ensure_ascii=False, separators=(",", ":"))
    if len(data.encode()) > MAX_DOC:
        raise HTTPException(413, "Слишком много данных для синхронизации")
    with db.tx() as conn:
        row = conn.execute(
            "SELECT rev, data, updated FROM docs WHERE user_id = ? AND kind = ? AND key = ?",
            (me.user_id, kind, key),
        ).fetchone()
        cur_rev = row["rev"] if row else None
        if cur_rev != body.base_rev:
            raise HTTPException(409, {
                "error": "Данные на сервере изменились",
                "rev": cur_rev,
                "data": json.loads(row["data"]) if row else None,
                "updated": row["updated"] if row else None,
            })
        rev = (cur_rev or 0) + 1
        conn.execute(
            "INSERT INTO docs (user_id, kind, key, rev, data, updated) VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT (user_id, kind, key) DO UPDATE SET rev = excluded.rev, data = excluded.data, "
            "updated = excluded.updated",
            (me.user_id, kind, key, rev, data, now()),
        )
    return {"rev": rev}

