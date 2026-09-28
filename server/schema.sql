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

-- совместные плейлисты (collab.py): живые, правки видны всем участникам
CREATE TABLE IF NOT EXISTS collabs (
    code       TEXT PRIMARY KEY,          -- как у share: 8 символов без 0/O/1/I
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    rev        INTEGER NOT NULL,          -- растёт при каждом изменении
    created    INTEGER NOT NULL,
    updated    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS collab_members (
    code       TEXT NOT NULL REFERENCES collabs(code) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined     INTEGER NOT NULL,
    PRIMARY KEY (code, user_id)
);
CREATE INDEX IF NOT EXISTS collab_members_user ON collab_members(user_id);
CREATE TABLE IF NOT EXISTS collab_tracks (
    code       TEXT NOT NULL REFERENCES collabs(code) ON DELETE CASCADE,
    track_id   TEXT NOT NULL,             -- id трека из плеера, например "ym:123"
    data       TEXT NOT NULL,             -- JSON снимка трека (как в альбомах)
    added_by   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at   INTEGER NOT NULL,
    pos        REAL NOT NULL,             -- порядок
    PRIMARY KEY (code, track_id)
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

-- реакции на сообщения: у каждого одна на сообщение (повторное нажатие снимает)
CREATE TABLE IF NOT EXISTS message_reactions (
    msg_id     INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    e          TEXT NOT NULL,
    at         INTEGER NOT NULL,
    PRIMARY KEY (msg_id, user_id)
);
CREATE INDEX IF NOT EXISTS messages_unread ON messages(to_id, read);

-- что сейчас играет у пользователя: видят только его друзья
CREATE TABLE IF NOT EXISTS nowplaying (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    track      TEXT NOT NULL,     -- JSON трека без путей к файлам
    playing    INTEGER NOT NULL,
    pos        REAL NOT NULL,     -- позиция, с, в момент at
    at         INTEGER NOT NULL   -- мс, серверное время
);
