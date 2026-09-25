"""Пароли (scrypt из стандартной библиотеки), токены сессий и простой лимит попыток входа."""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import threading
import time

# Параметры scrypt: ~16 МБ памяти и десятки миллисекунд на хеш — перебор дорогой, вход быстрый
N, R, P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=N, r=R, p=P, dklen=32)
    b64 = lambda b: base64.b64encode(b).decode()
    return f"scrypt${N}${R}${P}${b64(salt)}${b64(dk)}"


def check_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, dk = stored.split("$")
        if algo != "scrypt":
            return False
        want = base64.b64decode(dk)
        got = hashlib.scrypt(
            password.encode(), salt=base64.b64decode(salt),
            n=int(n), r=int(r), p=int(p), dklen=len(want),
        )
        return hmac.compare_digest(got, want)
    except (ValueError, TypeError):
        return False


# Хеш, который проверяем, когда логина нет: ответ по времени не выдаёт, существует ли аккаунт
DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    # В базе лежит только sha256 токена: утечка базы не даёт войти
    return hashlib.sha256(token.encode()).hexdigest()


class RateLimit:
    """Не больше `limit` неудачных попыток на ключ за `window` секунд."""

    def __init__(self, limit: int = 10, window: int = 15 * 60) -> None:
        self.limit = limit
        self.window = window
        self.fails: dict[str, list[float]] = {}
        self.lock = threading.Lock()

    def _fresh(self, key: str, now: float) -> list[float]:
        hits = [t for t in self.fails.get(key, []) if now - t < self.window]
        if hits:
            self.fails[key] = hits
        else:
            self.fails.pop(key, None)
        return hits

    def blocked(self, key: str) -> bool:
        with self.lock:
            return len(self._fresh(key, time.time())) >= self.limit

    def fail(self, key: str) -> None:
        with self.lock:
            now = time.time()
            self.fails[key] = self._fresh(key, now) + [now]

    def reset(self, key: str) -> None:
        with self.lock:
            self.fails.pop(key, None)
