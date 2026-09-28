// Сервер авеона: аккаунты, синхронизация, друзья, сообщения, «поделиться», совместные плейлисты,
// «Слушать вместе» и админка. Один бинарник, база — SQLite-файл.
//
// Настройки — переменные окружения:
//
//	AVEON_HOST         адрес (127.0.0.1; 0.0.0.0 — в Docker)
//	AVEON_PORT         порт (8787)
//	AVEON_DB           путь к базе (aveon.db в текущей папке)
//	AVEON_ADMINS       логины админов через запятую; без неё админки нет ни у кого
//	AVEON_PROXIES      от кого верить X-Forwarded-For: адреса и подсети через запятую, * — от всех (127.0.0.1,::1)
//	AVEON_BACKUPS      папка ежедневных копий базы (backups рядом с базой); пустая — не делать
//	AVEON_BACKUP_KEEP  сколько копий хранить (7)
//
// Сервер держит румы и приглашения в памяти, поэтому запускается одним процессом.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

var dbPath string

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return def
}

func routes() *http.ServeMux {
	mux := http.NewServeMux()
	h := mux.HandleFunc

	h("GET /api/health", api(health))
	h("POST /api/auth/register", api(register))
	h("POST /api/auth/login", api(login))
	h("POST /api/auth/logout", authed(logout))
	h("POST /api/auth/logout-all", authed(logoutAll))
	h("GET /api/me", authed(meGet))
	h("PATCH /api/me", authed(meUpdate))
	h("PUT /api/me/avatar", authed(meAvatar))
	h("POST /api/me/password", authed(mePassword))
	h("POST /api/me/delete", authed(meDelete))
	h("GET /api/avatar/{id}", authed(avatarGet))
	h("GET /api/sync", authed(syncGet))
	h("PUT /api/sync/{kind}/{key}", authed(syncPut))

	h("GET /api/together", together)

	h("POST /api/share", authed(sharePut))
	h("GET /api/share/{code}", authed(shareGet))
	h("GET /api/share/{code}/public", api(sharePublic))
	h("GET /t/{code}", api(trackPageHandler))

	h("GET /api/friends", authed(friendsList))
	h("POST /api/friends", authed(friendsAdd))
	h("POST /api/friends/{id}/accept", authed(friendsAccept))
	h("DELETE /api/friends/{id}", authed(friendsRemove))
	h("POST /api/friends/{id}/invite", authed(friendsInvite))
	h("DELETE /api/friends/{id}/invite", authed(friendsInviteDismiss))
	h("POST /api/friends/{id}/knock", authed(friendsKnock))
	h("DELETE /api/friends/{id}/knock", authed(friendsKnockDismiss))
	h("GET /api/friends/{id}/profile", authed(friendsProfile))
	h("PUT /api/now", authed(nowPut))

	h("GET /api/messages/{id}", authed(messagesGet))
	h("POST /api/messages/{id}", authed(messagesSend))
	h("PATCH /api/messages/{id}/{msg}", authed(messagesEdit))
	h("POST /api/messages/{id}/{msg}/react", authed(messagesReact))

	h("POST /api/collab", authed(collabCreate))
	h("GET /api/collab", authed(collabMine))
	h("GET /api/collab/{code}", authed(collabGet))
	h("PATCH /api/collab/{code}", authed(collabRename))
	h("POST /api/collab/{code}/join", authed(collabJoin))
	h("POST /api/collab/{code}/tracks", authed(collabTracksAdd))
	h("POST /api/collab/{code}/remove", authed(collabRemove))
	h("POST /api/collab/{code}/move", authed(collabMove))
	h("POST /api/collab/{code}/leave", authed(collabLeave))

	h("GET /api/admin/overview", adminOnly(adminOverview))
	h("GET /api/admin/users", adminOnly(adminUsers))
	h("POST /api/admin/users/{id}/logout", adminOnly(adminKick))
	h("POST /api/admin/users/{id}/ban", adminOnly(adminBan))
	h("POST /api/admin/users/{id}/rename", adminOnly(adminRename))
	h("POST /api/admin/users/{id}/notify", adminOnly(adminNotify))
	h("PUT /api/admin/announce", adminOnly(adminAnnounce))
	h("GET /api/announce", authed(announceGet))

	h("/", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 404, M{"error": "Нет такого адреса"}) })
	return mux
}

// housekeeping — раз в час: истёкшие сессии, старые попытки входа и приглашения из памяти, копия базы на сегодня
func housekeeping(ctx context.Context, backupDir string, keep int) {
	for {
		sessions, nowplaying, err := cleanup()
		if err != nil {
			slog.Error("cleanup", "err", err)
		}
		for _, l := range []*RateLimit{loginLimit, regLimit, joinLimit} {
			l.Prune()
		}
		pruneInvites()
		saved, err := backup(backupDir, keep)
		if err != nil {
			slog.Error("backup", "err", err)
		}
		if sessions+nowplaying > 0 || saved != "" {
			slog.Info("housekeeping", "sessions", sessions, "nowplaying", nowplaying, "backup", saved)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Hour):
		}
	}
}

// healthCheck — `aveon health`: для HEALTHCHECK в Docker, в образе нет curl
func healthCheck() {
	c := http.Client{Timeout: 3 * time.Second}
	r, err := c.Get("http://" + net.JoinHostPort("127.0.0.1", env("AVEON_PORT", "8787")) + "/api/health")
	if err != nil || r.StatusCode != 200 {
		os.Exit(1)
	}
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "health" {
		healthCheck()
		return
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, nil)))

	dbPath = env("AVEON_DB", "aveon.db")
	for _, a := range strings.Split(os.Getenv("AVEON_ADMINS"), ",") {
		if a = strings.ToLower(strings.TrimSpace(a)); a != "" {
			admins[a] = true
		}
	}
	setProxies(env("AVEON_PROXIES", "127.0.0.1,::1"))
	backupDir := env("AVEON_BACKUPS", filepath.Join(filepath.Dir(dbPath), "backups"))
	keep, err := strconv.Atoi(env("AVEON_BACKUP_KEEP", "7"))
	if err != nil || keep < 1 {
		keep = 7
	}

	if err := openDB(dbPath); err != nil {
		slog.Error("база не открылась", "path", dbPath, "err", err)
		os.Exit(1)
	}
	if len(admins) == 0 {
		slog.Warn("AVEON_ADMINS не задана — админка выключена")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go housekeeping(ctx, backupDir, keep)

	addr := net.JoinHostPort(env("AVEON_HOST", "127.0.0.1"), env("AVEON_PORT", "8787"))
	srv := &http.Server{
		Addr:              addr,
		Handler:           logRequests(routes()),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()
	slog.Info("авеон слушает", "addr", addr, "db", dbPath)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("сервер упал", "err", err)
		os.Exit(1)
	}
	db.Close()
}
