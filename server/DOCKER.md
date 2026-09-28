# Docker — управление сервером aveon

## Подключение к серверу

```bash
ssh root@166.1.144.61
```

## Основные команды

### Перейти в папку проекта

```bash
cd /opt/aveon/server
```

### Запуск / остановка / перезапуск

```bash
docker compose up -d          # запустить в фоне
docker compose down           # остановить и удалить контейнер
docker compose restart        # перезапустить
docker compose up -d --build  # пересобрать и запустить
```

### Логи

```bash
docker compose logs -f        # все логи в реальном времени
docker compose logs -f --tail=100   # последние 100 строк
docker logs server-aveon-api-1     # логи контейнера напрямую
```

### Внутри контейнера

Образ минимальный (distroless): шелла и утилит нет, внутри только бинарник `/aveon` и база `/data/aveon.db`.
Посмотреть базу — с хоста, через файл тома (см. ниже) или временным контейнером:

```bash
docker run --rm -it -v server_aveon-data:/data alpine sh -c "apk add -q sqlite && sqlite3 /data/aveon.db"
```

### Статус

```bash
docker ps                     # запущенные контейнеры
docker compose ps             # статус сервисов проекта
docker stats                  # потребление ресурсов
```

### База данных

Файл базы на хосте:

```
/var/lib/docker/volumes/server_aveon-data/_data/aveon.db
```

Замена базы:

```bash
cd /opt/aveon/server
docker compose down
cp /путь/к/новому/aveon.db /var/lib/docker/volumes/server_aveon-data/_data/aveon.db
chown 65532:65532 /var/lib/docker/volumes/server_aveon-data/_data/aveon.db   # контейнер работает не от root
docker compose up -d
```

### Резервные копии

Сервер сам раз в сутки кладёт копию базы в `/data/backups/aveon-ГГГГ-ММ-ДД.db` и хранит последние 7.
Они лежат в том же томе — раз в неделю стоит забирать их к себе:

```bash
scp root@166.1.144.61:/var/lib/docker/volumes/server_aveon-data/_data/backups/*.db .
```

### Переезд с версии на Python (один раз)

Новый контейнер работает не от root (uid 65532), а файлы в томе создал старый контейнер от root.
Перед первым запуском Go-версии:

```bash
cd /opt/aveon/server
docker compose down
cp /var/lib/docker/volumes/server_aveon-data/_data/aveon.db ~/aveon-before-go.db   # на всякий случай
docker run --rm -v server_aveon-data:/data alpine chown -R 65532:65532 /data
docker compose up -d --build
docker compose logs -f --tail=20   # должно быть «авеон слушает»
```

База та же, пароли и сессии остаются — пользователям перелогиниваться не нужно.

Если nginx ходил на порт через внешний адрес сервера, а не `127.0.0.1`, поправь `proxy_pass` на
`http://127.0.0.1:8787`: порт теперь открыт только для локальных подключений.

### Обновление кода

```bash
cd /opt/aveon/server
# скопировать новые файлы на сервер (scp или git pull)
docker compose up -d --build
```

### Nginx (HTTPS)

Конфиг: `/etc/nginx/sites-available/api.music.aveon.su`

```bash
nginx -t                     # проверить конфиг
systemctl reload nginx       # перезагрузить
certbot --nginx -d api.music.aveon.su   # обновить сертификат
```

## Переменные окружения

| Переменная | По умолчанию | Что это |
|---|---|---|
| `AVEON_HOST` | `0.0.0.0` | адрес внутри контейнера |
| `AVEON_PORT` | `8787` | порт |
| `AVEON_DB` | `/data/aveon.db` | путь к базе внутри контейнера |
| `AVEON_ADMINS` | — | логины админов через запятую; без неё админки нет ни у кого (задана в docker-compose.yml) |
| `AVEON_PROXIES` | `*` в compose | от кого верить `X-Forwarded-For`; `*` можно, потому что порт открыт только для nginx |
| `AVEON_BACKUPS` | `/data/backups` | папка ежедневных копий базы |
| `AVEON_BACKUP_KEEP` | `7` | сколько копий хранить |

## Порты

- `8787` — API, только на `127.0.0.1` (для nginx)
- `80` — nginx (HTTP → HTTPS)
- `443` — nginx (HTTPS)
