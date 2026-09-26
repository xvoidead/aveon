"""SQLite: пользователи, сессии входа и синхронизируемые документы.

Каждый запрос открывает своё соединение — sqlite3 не любит, когда одно
соединение гоняют между потоками uvicorn.
"""
from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

# Путь можно поменять до первого запроса: db.DB_PATH = Path(...)
DB_PATH = Path(os.environ.get("AVEON_DB") or Path(__file__).resolve().parent.parent / "aveon.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY,
    login      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name       TEXT NOT NULL,
    pw_hash    TEXT NOT NULL,
    created    INTEGER NOT NULL,
    avatar     TEXT NOT NULL DEFAULT '',   -- data:image/…;base64, квадрат 256×256
    avatar_at  INTEGER NOT NULL DEFAULT 0  -- когда меняли: по нему плеер понимает, что кэш устарел
);

CREATE TABLE IF NOT EXISTS sessions (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    device     TEXT NOT NULL DEFAULT '',
    created    INTEGER NOT NULL,
    last_used  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- kind: albums | settings | stats; key: main или id устройства (у статистики своя на каждый компьютер)
CREATE TABLE IF NOT EXISTS docs (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    key        TEXT NOT NULL,
    rev        INTEGER NOT NULL,
    data       TEXT NOT NULL,
    updated    INTEGER NOT NULL,
    PRIMARY KEY (user_id, kind, key)
);

-- «поделиться»: неизменяемые снимки альбомов и пресетов по короткому коду
CREATE TABLE IF NOT EXISTS shares (
    code       TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    data       TEXT NOT NULL,
    created    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS shares_user ON shares(user_id, created);

-- друзья: заявка from_id → to_id; принятая дружба лежит двумя строками (a→b и b→a)
CREATE TABLE IF NOT EXISTS friend_requests (
    from_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created    INTEGER NOT NULL,
    PRIMARY KEY (from_id, to_id)
);
CREATE INDEX IF NOT EXISTS friend_requests_to ON friend_requests(to_id);

CREATE TABLE IF NOT EXISTS friends (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    since      INTEGER NOT NULL,
    PRIMARY KEY (user_id, friend_id)
);

-- разные настройки сервера: объявление из админки и т. п.
CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL
);

-- сообщения между друзьями: текст и/или трек (JSON)
CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY,
    from_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text       TEXT NOT NULL DEFAULT '',
    track      TEXT,
    created    INTEGER NOT NULL,
    read       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS messages_pair ON messages(from_id, to_id, id);
CREATE INDEX IF NOT EXISTS messages_unread ON messages(to_id, read);

-- что сейчас играет у пользователя: видят только его друзья
CREATE TABLE IF NOT EXISTS nowplaying (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    track      TEXT NOT NULL,     -- JSON трека без путей к файлам
    playing    INTEGER NOT NULL,
    pos        REAL NOT NULL,     -- позиция, с, в момент at
    at         INTEGER NOT NULL   -- мс, серверное время
);
"""


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


@contextmanager
def tx():
    """Соединение с транзакцией: commit при успехе, rollback при исключении."""
    conn = connect()
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def init() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with tx() as conn:
        conn.executescript(SCHEMA)
        # база, созданная до аватаров: добавляем колонки
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(users)")}
        if "avatar" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT ''")
        if "avatar_at" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN avatar_at INTEGER NOT NULL DEFAULT 0")
        if "banned" not in cols:  # админка: заблокированный не может войти
            conn.execute("ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0")
