# сервер аккаунтов авеона

Небольшое API на FastAPI + SQLite: регистрация, вход и синхронизация альбомов, настроек бочки
и статистики между компьютерами. Музыку и токены сервисов сервер не видит.

## запуск

```bash
cd server
python -m venv .venv
.venv/bin/pip install -r requirements.txt      # Windows: .venv\Scripts\pip
.venv/bin/python run.py
```

По умолчанию слушает `127.0.0.1:8787`, база — `server/aveon.db`. Настраивается переменными:

| переменная | по умолчанию | что это |
|---|---|---|
| `AVEON_HOST` | `127.0.0.1` | адрес; `0.0.0.0`, если без nginx |
| `AVEON_PORT` | `8787` | порт |
| `AVEON_DB` | `server/aveon.db` | путь к базе |

Документация API: `http://<сервер>:8787/api/docs`.

## вместе с telegram-ботом (один процесс)

Если хостинг даёт одну команду запуска, API можно поднять прямо внутри бота на aiogram:

1. Скопируй папку `aveon_api/` в папку бота.
2. Положи туда `services/api.py` (запускает uvicorn в том же asyncio-цикле, сигналы оставляет aiogram)
   и вызови его в `bot.py`: `stop_api = await aveon_api.start()` перед поллингом, `await stop_api()` в `finally`.
3. Добавь `fastapi` и `uvicorn` в `requirements.txt` бота.

Команда запуска остаётся `python bot.py`. Настройки — секция `"api"` в `config.json` бота:
`{"enabled": true, "host": "0.0.0.0", "port": null, "db": "aveon.db"}`. При `port: null` берётся
порт, который выдала панель (`SERVER_PORT`), иначе 8787. Если API не стартовало, бот работает дальше.

## отдельным сервисом рядом с ботом

API — отдельный процесс со своим venv, портом и базой, бот он не трогает. На сервере с systemd:

```ini
# /etc/systemd/system/aveon-api.service
[Unit]
Description=aveon accounts API
After=network.target

[Service]
WorkingDirectory=/opt/aveon/server
ExecStart=/opt/aveon/server/.venv/bin/python run.py
Environment=AVEON_DB=/opt/aveon/data/aveon.db
Restart=always
User=aveon

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now aveon-api
```

Пароли уходят на сервер при входе, поэтому снаружи нужен https. Проще всего nginx + certbot:

```nginx
server {
    server_name aveon.example.ru;
    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 6m;
    }
}
```

В плеере: настройки → «Аккаунт» → сервер `https://aveon.example.ru`.

## API

Все ответы JSON, ошибки — `{"error": "текст"}`. Кроме регистрации и входа нужен заголовок
`Authorization: Bearer <token>`.

| метод | путь | что делает |
|---|---|---|
| `POST` | `/api/auth/register` | `{login, password, name?, device?}` → `{token, user}` |
| `POST` | `/api/auth/login` | `{login, password, device?}` → `{token, user}`; 10 неудачных попыток за 15 минут — 429 |
| `POST` | `/api/auth/logout` | закрыть текущую сессию |
| `POST` | `/api/auth/logout-all` | закрыть все сессии, кроме текущей |
| `GET` | `/api/me` | профиль и список сессий |
| `PATCH` | `/api/me` | `{name}` |
| `POST` | `/api/me/password` | `{old, new}`; остальные сессии закрываются |
| `POST` | `/api/me/delete` | `{password}`; удаляет аккаунт и все данные |
| `GET` | `/api/sync` | все документы пользователя |
| `PUT` | `/api/sync/{kind}/{key}` | `{data, base_rev}`; `kind` — `albums`, `settings` или `stats`. Если на сервере ревизия уже другая, ответ 409 с текущими данными |

## друзья

Друзья добавляются по логину: заявка → друг принимает (или сам отправляет заявку в ответ — тогда дружба
начинается сразу). Плеер сообщает серверу, что у него играет, и раз в минуту напоминает. Друзья видят трек,
паузу и позицию; кто не напоминал дольше 2,5 минут — не в сети, виден только последний трек. Посторонним
чужой трек не виден. В плеере это можно выключить: «Друзья» → «Показывать друзьям, что я слушаю».

| метод | путь | что делает |
|---|---|---|
| `GET` | `/api/friends` | `{friends, incoming, outgoing, now}`; у друга `now: {track, playing, pos, at, live}` или `null` |
| `POST` | `/api/friends` | `{login}` → `{status: "sent" \| "friends"}` |
| `POST` | `/api/friends/{id}/accept` | принять заявку |
| `DELETE` | `/api/friends/{id}` | удалить из друзей, отклонить или отозвать заявку |
| `POST` / `DELETE` | `/api/friends/{id}/invite` | `{code}` — позвать друга в руму / убрать приглашение от него |
| `POST` / `DELETE` | `/api/friends/{id}/knock` | попроситься в руму к другу / убрать его просьбу |
| `PUT` | `/api/now` | `{track, playing, pos}`; `track: null` — ничего не играет |

## слушать вместе

WebSocket `/api/together`: румы с кодом из 6 символов, до 10 человек. Сервер пересылает состояние
(трек, играет/пауза, позиция и серверное время) и отдаёт его тем, кто вошёл позже. Звук сервер не передаёт:
каждый плеер играет трек сам. Румы живут в памяти и исчезают, когда из них вышли все.
Протокол описан в начале `aveon_api/together.py`. Нужен пакет `websockets` (есть в requirements.txt).

Пароли хранятся как scrypt-хеши, токены — как sha256, сессия живёт 90 дней с последнего запроса.

## тесты

```bash
.venv/bin/pip install pytest httpx
.venv/bin/python -m pytest test_app.py
```
