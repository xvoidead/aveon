# сервер аккаунтов авеона

Один бинарник на Go + SQLite: регистрация, вход, синхронизация альбомов, настроек бочки и статистики
между компьютерами, друзья, сообщения, совместные плейлисты и «Слушать вместе». Музыку и токены сервисов
сервер не видит.

## запуск

Нужен Go 1.27+ (cgo не нужен: SQLite на чистом Go).

```bash
cd server
go build -o aveon .        # Windows: -o aveon.exe
./aveon
```

Для Linux-сервера можно собрать прямо с Windows: `GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o aveon .`

По умолчанию слушает `127.0.0.1:8787`, база — `aveon.db` в текущей папке. Настраивается переменными:

| переменная | по умолчанию | что это |
|---|---|---|
| `AVEON_HOST` | `127.0.0.1` | адрес; `0.0.0.0` — в Docker |
| `AVEON_PORT` | `8787` | порт |
| `AVEON_DB` | `aveon.db` | путь к базе |
| `AVEON_ADMINS` | — | логины админов через запятую; без неё админки нет ни у кого |
| `AVEON_PROXIES` | `127.0.0.1,::1` | от кого верить `X-Forwarded-For` (адреса и подсети через запятую, `*` — от всех). Нужно, чтобы лимит попыток входа считал настоящие IP, а не адрес nginx |
| `AVEON_BACKUPS` | `backups` рядом с базой | куда класть ежедневные копии базы; пустая строка — не делать |
| `AVEON_BACKUP_KEEP` | `7` | сколько копий хранить |

Сервер держит румы и приглашения в памяти, поэтому запускается **одним процессом**; после перезапуска румы
пропадают (плееры переподключаются сами). Раз в час он удаляет истёкшие сессии и раз в сутки делает копию
базы (`VACUUM INTO`, безопасно на живой базе). Копии лежат на том же диске — для защиты от потери сервера
их стоит забирать куда-то ещё.

База совместима с версией на Python: те же таблицы, пароли в том же формате scrypt. Достаточно подложить
старый `aveon.db`.

## на сервере

В Docker — см. [DOCKER.md](DOCKER.md). Без Docker, через systemd:

```ini
# /etc/systemd/system/aveon-api.service
[Unit]
Description=aveon accounts API
After=network.target

[Service]
ExecStart=/opt/aveon/server/aveon
Environment=AVEON_DB=/opt/aveon/data/aveon.db
Environment=AVEON_ADMINS=логин1,логин2
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
    client_max_body_size 6m;
    # /t/ — публичная страница трека: из неё Discord берёт превью ссылки
    location /t/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;                  # для WebSocket «Слушать вместе»
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 1h;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
# в блоке http {}:
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
```

В плеере: настройки → «Аккаунт» → сервер `https://aveon.example.ru`.

## API

Все ответы JSON, ошибки — `{"error": "текст"}`. Кроме регистрации и входа нужен заголовок
`Authorization: Bearer <token>`.

| метод | путь | что делает |
|---|---|---|
| `POST` | `/api/auth/register` | `{login, password, name?, device?}` → `{token, user}`; больше 10 аккаунтов с одного IP в час — 429 |
| `POST` | `/api/auth/login` | `{login, password, device?}` → `{token, user}`; 10 неудачных попыток за 15 минут — 429 |
| `POST` | `/api/auth/logout` | закрыть текущую сессию |
| `POST` | `/api/auth/logout-all` | закрыть все сессии, кроме текущей |
| `GET` | `/api/me` | профиль и список сессий |
| `PATCH` | `/api/me` | `{name}` |
| `POST` | `/api/me/password` | `{old, new}`; остальные сессии закрываются |
| `POST` | `/api/me/delete` | `{password}`; удаляет аккаунт и все данные |
| `GET` | `/api/sync` | все документы пользователя |
| `PUT` | `/api/sync/{kind}/{key}` | `{data, base_rev}`; `kind` — `albums`, `settings`, `stats` или `keys`. Если на сервере ревизия уже другая, ответ 409 с текущими данными. Документ до 5 МБ, у пользователя до 32 документов и 40 МБ всего — иначе 413 |

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
| `GET` | `/api/messages/{id}?before=` | переписка с другом, по 50; входящие отмечаются прочитанными |
| `POST` | `/api/messages/{id}` | `{text?, track?}` — сообщение другу; в списке друзей у каждого `unread` и `last` |
| `PUT` | `/api/now` | `{track, playing, pos}`; `track: null` — ничего не играет |

## совместные плейлисты

Живой плейлист по коду из 8 символов: несколько человек добавляют треки, правки видны всем. До 20 участников
и 2000 треков, снимок трека — до 8 КБ. Клиент опрашивает `GET /api/collab/{code}` раз в 15 с и перерисовывает
список, когда меняется `rev`. Подробности — в начале `collab.go`.

| метод | путь | что делает |
|---|---|---|
| `POST` | `/api/collab` | `{title, tracks}` → `{code}`; создатель сразу участник |
| `GET` | `/api/collab` | плейлисты, где я участник: `[{code, title, count, members, updated, rev}]` |
| `GET` | `/api/collab/{code}` | `{code, title, owner, rev, updated, members, tracks}` — только участникам |
| `POST` | `/api/collab/{code}/join` | войти по коду, ответ как у `GET` |
| `POST` | `/api/collab/{code}/tracks` | `{tracks}` → `{rev}`; в конец, дубликаты пропускаются |
| `POST` | `/api/collab/{code}/remove` | `{ids}` → `{rev}`; убрать может добавивший или владелец |
| `POST` | `/api/collab/{code}/move` | `{id, before}` → `{rev}`; `before: null` — в конец |
| `PATCH` | `/api/collab/{code}` | `{title}` → `{rev}`; только владелец |
| `POST` | `/api/collab/{code}/leave` | ушёл владелец — плейлист самому раннему участнику; никого нет — удаляется |

## трек по ссылке (превью в Discord)

`POST /api/share` с `kind: "track"` и `data: {track, room?}` (до 16 КБ) даёт код. Ссылка
`https://{сервер}/t/{code}` открывает публичную страницу без входа: обложка, название, «Открыть в авеоне»
(`aveon://track/{code}`) и в сервисе трека. В `<head>` — теги `og:*`, по ним Discord строит карточку.
`GET /api/share/{code}/public` отдаёт трек без авторизации (только `kind == "track"`).

## слушать вместе

WebSocket `/api/together`: румы с кодом из 6 символов, до 10 человек. Сервер пересылает состояние
(трек, играет/пауза, позиция и серверное время) и отдаёт его тем, кто вошёл позже. Звук сервер не передаёт:
каждый плеер играет трек сам. Румы живут в памяти и исчезают, когда из них вышли все.
Протокол описан в начале `together.go`. Реакции: `react {e}` — одна из 🔥 😍 😂 🎉 👏 💀 🥁 🛢, не чаще раза в 300 мс; сервер рассылает всем в руме. Больше 20 неверных кодов за 10 минут — пауза, чтобы коды не подбирали перебором.

Пароли хранятся как scrypt-хеши, токены — как sha256, сессия живёт 90 дней с последнего запроса.

## тесты

Тесты на Python проверяют сервер снаружи, как это делает плеер: каждый тест запускает собранный бинарник
на чистой базе и ходит в него по HTTP и WebSocket.

```bash
go build -o aveon.exe .          # на Linux/macOS: -o aveon
pip install pytest httpx websockets
python -m pytest tests
```
