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
