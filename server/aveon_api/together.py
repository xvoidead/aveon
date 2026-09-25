"""Совместное прослушивание: комнаты на WebSocket.

Один создаёт комнату и получает код, друзья входят по коду. Сервер хранит последнее
состояние (трек, играет/пауза, позиция и серверное время этой позиции) и пересылает
его остальным. Звук сервер не передаёт — каждый плеер играет трек сам.

Протокол — JSON-сообщения с полем "t":
  клиент → сервер
    hello  {token}                   первым сообщением, иначе соединение закрывается
    create {}                        создать комнату
    join   {code}                    войти в комнату
    state  {state, beat?}            новое состояние; отправитель становится ведущим
    ping   {c}                       сверка часов: c — время клиента
    leave  {}
  сервер → клиент
    hello   {you, now}
    room    {code, you, members, driver, state, now}
    state   {state, driver, by, beat, now}
    members {members, driver, joined?, left?}
    pong    {c, s}
    error   {error}
"""
from __future__ import annotations

import asyncio
import json
import secrets
import time
from dataclasses import dataclass, field

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

router = APIRouter()

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # без 0/O и 1/I, чтобы код легко продиктовать
CODE_LEN = 6
MAX_MEMBERS = 10
MAX_MESSAGE = 64 * 1024


def now_ms() -> int:
    return int(time.time() * 1000)


@dataclass
class Member:
    id: str
    user_id: int
    name: str
    ws: WebSocket


@dataclass
class Room:
    code: str
    members: dict[str, Member] = field(default_factory=dict)
    state: dict | None = None
    driver: str | None = None  # кто последним менял трек — он и переключает дальше

    def view(self) -> list[dict]:
        return [{"id": m.id, "name": m.name} for m in self.members.values()]


ROOMS: dict[str, Room] = {}


def new_code() -> str:
    while True:
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LEN))
        if code not in ROOMS:
            return code


async def send(member: Member, msg: dict) -> None:
    try:
        await member.ws.send_json(msg)
    except Exception:
        pass  # отвалившегося участника уберёт его собственный обработчик


async def broadcast(room: Room, msg: dict, skip: str | None = None) -> None:
    await asyncio.gather(*(send(m, msg) for m in list(room.members.values()) if m.id != skip))


def who(token: str) -> tuple[int, str]:
    from .app import auth, get_user  # отложенно: app.py подключает этот модуль
    from . import db

    me = auth(f"Bearer {token}")
    with db.tx() as conn:
        user = get_user(conn, me.user_id)
    return me.user_id, user["name"]


def room_msg(room: Room, member: Member) -> dict:
    return {
        "t": "room", "code": room.code, "you": member.id,
        "members": room.view(), "driver": room.driver, "state": room.state, "now": now_ms(),
    }


async def leave(room: Room | None, member: Member) -> None:
    if not room or member.id not in room.members:
        return
    del room.members[member.id]
    if not room.members:
        ROOMS.pop(room.code, None)
        return
    if room.driver == member.id:
        room.driver = None
    await broadcast(room, {"t": "members", "members": room.view(), "driver": room.driver, "left": member.name})


@router.websocket("/api/together")
async def together(ws: WebSocket):
    await ws.accept()
    try:
        hello = await asyncio.wait_for(ws.receive_json(), 10)
        user_id, name = who(str(hello.get("token", ""))) if hello.get("t") == "hello" else (None, None)
    except (asyncio.TimeoutError, HTTPException, ValueError, WebSocketDisconnect):
        user_id = None
    if user_id is None:
        await ws.send_json({"t": "error", "error": "Нужно войти в аккаунт", "fatal": True})
        await ws.close(4401)
        return

    member = Member(id=secrets.token_hex(4), user_id=user_id, name=name, ws=ws)
    room: Room | None = None
    await ws.send_json({"t": "hello", "you": member.id, "now": now_ms()})

    try:
        while True:
            raw = await ws.receive_text()
            if len(raw) > MAX_MESSAGE:
                await send(member, {"t": "error", "error": "Слишком большое сообщение"})
                continue
            try:
                msg = json.loads(raw)
                kind = msg.get("t")
            except (ValueError, AttributeError):
                continue

            if kind == "ping":
                await send(member, {"t": "pong", "c": msg.get("c"), "s": now_ms()})

            elif kind in ("create", "join"):
                await leave(room, member)
                room = None
                if kind == "create":
                    room = Room(code=new_code())
                    ROOMS[room.code] = room
                else:
                    code = str(msg.get("code", "")).strip().upper()
                    room = ROOMS.get(code)
                    if not room:
                        await send(member, {"t": "error", "error": "Комната не найдена. Проверь код"})
                        continue
                    if len(room.members) >= MAX_MEMBERS:
                        room = None
                        await send(member, {"t": "error", "error": "В комнате уже 10 человек"})
                        continue
                room.members[member.id] = member
                await send(member, room_msg(room, member))
                await broadcast(room, {"t": "members", "members": room.view(), "driver": room.driver,
                                       "joined": member.name}, skip=member.id)

            elif kind == "state" and room:
                st = msg.get("state")
                try:
                    if not isinstance(st.get("track"), dict):
                        continue
                    st = {"track": st["track"], "playing": bool(st.get("playing")),
                          "pos": max(0.0, float(st.get("pos") or 0)), "at": now_ms()}
                except (AttributeError, TypeError, ValueError):
                    continue
                room.state = st
                room.driver = member.id
                await broadcast(room, {"t": "state", "state": st, "driver": member.id, "by": member.name,
                                       "beat": bool(msg.get("beat")), "now": now_ms()}, skip=member.id)

            elif kind == "leave":
                await leave(room, member)
                room = None
                await ws.close()
                return
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await leave(room, member)
