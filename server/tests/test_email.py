"""Почта аккаунта и сброс пароля по коду из письма.

Письма ловит маленький SMTP-сервер прямо в тесте: без STARTTLS и AUTH, как это делает
сервер авеона, когда AVEON_SMTP_USER не задан.
"""
import email
import email.policy
import os
import re
import socket
import subprocess
import tempfile
import threading
import time
from pathlib import Path

import httpx
import pytest

from test_api import BIN, Client, free_port, h, register


class FakeSMTP:
    """Принимает письма и складывает их в self.mails: [{"to": [...], "msg": EmailMessage}]."""

    def __init__(self):
        self.mails = []
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen()
        self.port = self.sock.getsockname()[1]
        threading.Thread(target=self.serve, daemon=True).start()

    def serve(self):
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            threading.Thread(target=self.session, args=(conn,), daemon=True).start()

    def session(self, conn):
        f = conn.makefile("rb")
        send = lambda line: conn.sendall(line.encode() + b"\r\n")
        send("220 fake ESMTP")
        rcpt = []
        try:
            while line := f.readline():
                cmd = line.decode().strip().upper()
                if cmd.startswith(("EHLO", "HELO")):
                    send("250-fake")
                    send("250 8BITMIME")
                elif cmd.startswith("MAIL"):
                    rcpt = []
                    send("250 ok")
                elif cmd.startswith("RCPT"):
                    rcpt.append(re.search(r"<([^>]*)>", line.decode()).group(1))
                    send("250 ok")
                elif cmd == "DATA":
                    send("354 go")
                    data = b""
                    while (l := f.readline()) not in (b".\r\n", b""):
                        data += l[1:] if l.startswith(b"..") else l
                    self.mails.append({"to": rcpt, "msg": email.message_from_bytes(data, policy=email.policy.default)})
                    send("250 queued")
                elif cmd == "QUIT":
                    send("221 bye")
                    return
                else:
                    send("250 ok")
        finally:
            conn.close()

    def wait(self, n, timeout=5):
        end = time.time() + timeout
        while len(self.mails) < n and time.time() < end:
            time.sleep(0.05)
        assert len(self.mails) >= n, f"писем {len(self.mails)}, ждали {n}"
        return self.mails[n - 1]

    def close(self):
        self.sock.close()


def code_of(mail):
    text = mail["msg"].get_body(preferencelist=("plain",)).get_content()
    return re.search(r"\b(\d{6})\b", text).group(1)


@pytest.fixture()
def smtp():
    s = FakeSMTP()
    yield s
    s.close()


@pytest.fixture()
def client(smtp):
    folder = Path(tempfile.mkdtemp())
    port = free_port()
    env = os.environ | {"AVEON_HOST": "127.0.0.1", "AVEON_PORT": str(port), "AVEON_DB": str(folder / "test.db"),
                        "AVEON_BACKUPS": "", "AVEON_SMTP_HOST": "127.0.0.1", "AVEON_SMTP_PORT": str(smtp.port),
                        "AVEON_SMTP_FROM": "Авеон <noreply@aveon.test>"}
    env.pop("AVEON_SMTP_USER", None)
    proc = subprocess.Popen([str(BIN)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            if httpx.get(base + "/api/health", trust_env=False).status_code == 200:
                break
        except httpx.HTTPError:
            time.sleep(0.05)
    else:
        proc.kill()
        pytest.fail("сервер не запустился")
    with Client(base_url=base, timeout=10, trust_env=False) as c:
        yield c
    proc.terminate()
    proc.wait(5)


def add_email(c, smtp, token, addr):
    n = len(smtp.mails)
    r = c.post("/api/me/email", headers=h(token), json={"email": addr})
    assert r.status_code == 200, r.text
    mail = smtp.wait(n + 1)
    assert mail["to"] == [addr]
    r = c.post("/api/me/email/confirm", headers=h(token), json={"code": code_of(mail)})
    assert r.status_code == 200, r.text
    return r.json()


def test_add_and_confirm_email(client, smtp):
    token, _ = register(client)
    r = client.post("/api/me/email", headers=h(token), json={"email": "  Me@Example.COM "})
    assert r.status_code == 200
    mail = smtp.wait(1)
    assert mail["to"] == ["me@example.com"]
    assert "noreply@aveon.test" in mail["msg"]["From"]
    assert mail["msg"]["Subject"]  # тема есть и раскодируется

    me = client.get("/api/me", headers=h(token)).json()["user"]
    assert me["email"] == "" and me["email_pending"] == "me@example.com"  # пока не подтвердили — почты нет

    assert client.post("/api/me/email/confirm", headers=h(token), json={"code": "000000"}).status_code == 400
    r = client.post("/api/me/email/confirm", headers=h(token), json={"code": code_of(mail)})
    assert r.status_code == 200
    assert r.json()["user"]["email"] == "me@example.com"
    assert r.json()["user"]["email_pending"] == ""
    # код одноразовый
    assert client.post("/api/me/email/confirm", headers=h(token), json={"code": code_of(mail)}).status_code == 400


def test_email_validation_and_uniqueness(client, smtp):
    t1, _ = register(client)
    t2, _ = register(client)
    for bad in ["nope", "a@b", "@x.ru", "a b@x.ru", "x" * 250 + "@x.ru"]:
        assert client.post("/api/me/email", headers=h(t1), json={"email": bad}).status_code == 400, bad
    add_email(client, smtp, t1, "taken@example.com")
    r = client.post("/api/me/email", headers=h(t2), json={"email": "TAKEN@example.com"})
    assert r.status_code == 409
    assert "error" in r.json()


def test_remove_email(client, smtp):
    token, _ = register(client)
    add_email(client, smtp, token, "gone@example.com")
    sent = len(smtp.mails)
    r = client.post("/api/me/email", headers=h(token), json={"email": ""})
    assert r.status_code == 200
    assert r.json()["user"]["email"] == ""
    time.sleep(0.3)
    assert len(smtp.mails) == sent  # чтобы убрать почту, письмо не нужно


def test_reset_password_by_login(client, smtp):
    old, login = register(client)
    add_email(client, smtp, old, "reset@example.com")
    n = len(smtp.mails)

    r = client.post("/api/auth/reset/request", json={"login": login})
    assert r.status_code == 200 and r.json() == {"ok": True}
    mail = smtp.wait(n + 1)
    assert mail["to"] == ["reset@example.com"]

    r = client.post("/api/auth/reset/confirm",
                    json={"login": login, "code": code_of(mail), "password": "brand-new-pw", "device": "phone"})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["login"] == login
    new = r.json()["token"]

    assert client.get("/api/me", headers=h(old)).status_code == 401  # старые устройства вылетели
    assert client.get("/api/me", headers=h(new)).status_code == 200
    assert client.post("/api/auth/login", json={"login": login, "password": "password123"}).status_code == 401
    assert client.post("/api/auth/login", json={"login": login, "password": "brand-new-pw"}).status_code == 200
    # код одноразовый
    r = client.post("/api/auth/reset/confirm",
                    json={"login": login, "code": code_of(mail), "password": "another-pw-1"})
    assert r.status_code == 400


def test_reset_password_by_email(client, smtp):
    token, login = register(client)
    add_email(client, smtp, token, "byemail@example.com")
    n = len(smtp.mails)
    assert client.post("/api/auth/reset/request", json={"login": "ByEmail@Example.com"}).status_code == 200
    mail = smtp.wait(n + 1)
    r = client.post("/api/auth/reset/confirm",
                    json={"login": "byemail@example.com", "code": code_of(mail), "password": "brand-new-pw"})
    assert r.status_code == 200
    assert r.json()["user"]["login"] == login


def test_reset_does_not_reveal_accounts(client, smtp):
    token, login = register(client)  # аккаунт без почты
    for who in ["no-such-user", "nobody@example.com", login]:
        r = client.post("/api/auth/reset/request", json={"login": who})
        assert r.status_code == 200 and r.json() == {"ok": True}, who
    time.sleep(0.5)
    assert smtp.mails == []
    r = client.post("/api/auth/reset/confirm", json={"login": "no-such-user", "code": "123456", "password": "whatever-1"})
    assert r.status_code == 400


def test_reset_code_attempts_are_limited(client, smtp):
    token, login = register(client)
    add_email(client, smtp, token, "limit@example.com")
    n = len(smtp.mails)
    client.post("/api/auth/reset/request", json={"login": login})
    good = code_of(smtp.wait(n + 1))
    wrong = "000000" if good != "000000" else "111111"
    for _ in range(5):
        r = client.post("/api/auth/reset/confirm", json={"login": login, "code": wrong, "password": "brand-new-pw"})
        assert r.status_code == 400
    # после пяти ошибок код сгорел, даже верный не подходит
    r = client.post("/api/auth/reset/confirm", json={"login": login, "code": good, "password": "brand-new-pw"})
    assert r.status_code == 400
    assert client.post("/api/auth/login", json={"login": login, "password": "password123"}).status_code == 200


def test_reset_checks_new_password(client, smtp):
    token, login = register(client)
    add_email(client, smtp, token, "short@example.com")
    n = len(smtp.mails)
    client.post("/api/auth/reset/request", json={"login": login})
    code = code_of(smtp.wait(n + 1))
    r = client.post("/api/auth/reset/confirm", json={"login": login, "code": code, "password": "short"})
    assert r.status_code == 400
    # короткий пароль не тратит код
    r = client.post("/api/auth/reset/confirm", json={"login": login, "code": code, "password": "long-enough-1"})
    assert r.status_code == 200


def test_reset_mail_rate_limit(client, smtp):
    token, login = register(client)
    add_email(client, smtp, token, "spam@example.com")
    n = len(smtp.mails)
    for _ in range(8):
        assert client.post("/api/auth/reset/request", json={"login": login}).status_code in (200, 429)
    time.sleep(0.5)
    assert len(smtp.mails) - n <= 3  # не больше трёх писем на аккаунт в час


def test_reset_check_code_before_password(client, smtp):
    token, login = register(client)
    add_email(client, smtp, token, "check@example.com")
    n = len(smtp.mails)
    client.post("/api/auth/reset/request", json={"login": login})
    good = code_of(smtp.wait(n + 1))
    wrong = "000000" if good != "000000" else "111111"

    assert client.post("/api/auth/reset/check", json={"login": login, "code": wrong}).status_code == 400
    r = client.post("/api/auth/reset/check", json={"login": login, "code": good})
    assert r.status_code == 200 and r.json() == {"ok": True}
    # проверка код не гасит: им же меняем пароль
    r = client.post("/api/auth/reset/confirm", json={"login": login, "code": good, "password": "brand-new-pw"})
    assert r.status_code == 200
    assert client.post("/api/auth/reset/check", json={"login": login, "code": good}).status_code == 400


def test_reset_check_counts_attempts(client, smtp):
    token, login = register(client)
    add_email(client, smtp, token, "check2@example.com")
    n = len(smtp.mails)
    client.post("/api/auth/reset/request", json={"login": login})
    good = code_of(smtp.wait(n + 1))
    wrong = "000000" if good != "000000" else "111111"
    for _ in range(5):
        assert client.post("/api/auth/reset/check", json={"login": login, "code": wrong}).status_code == 400
    assert client.post("/api/auth/reset/check", json={"login": login, "code": good}).status_code == 400
    assert client.post("/api/auth/reset/check", json={"login": "nobody-here", "code": good}).status_code == 400
