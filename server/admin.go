// Админка: только для логинов из AVEON_ADMINS.
//
//	GET  /api/admin/overview                 → сводка: пользователи, кто онлайн и что слушает, румы, сообщения
//	GET  /api/admin/users?q=&limit=          → пользователи (поиск по логину и имени)
//	POST /api/admin/users/{id}/logout        → закрыть все его сессии
//	POST /api/admin/users/{id}/ban {banned}  → заблокировать (и выкинуть отовсюду) / разблокировать
//	POST /api/admin/users/{id}/rename {name} → сменить имя (например, за оскорбительное)
//	PUT  /api/admin/announce {text, track?}  → объявление всем (с треком — «трек дня»); пустой текст — убрать
//	POST /api/admin/users/{id}/notify {text} → личное уведомление одному
//	GET  /api/announce                       → объявление и личное уведомление (для всех вошедших)
package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var started = time.Now().Unix()

// общий топ по статистике всех — считать дорого, держим минуту
var (
	topMu sync.Mutex
	topAt time.Time
	topV  M
)

func adminOnly(fn func(r *http.Request, me Auth) (any, error)) http.HandlerFunc {
	return authed(func(r *http.Request, me Auth) (any, error) {
		row, err := one(db, "SELECT login FROM users WHERE id = ?", me.UserID)
		if err != nil {
			return nil, err
		}
		if row == nil || !isAdmin(row.Str("login")) {
			return nil, fail(403, "Только для админов")
		}
		return fn(r, me)
	})
}

// perDay — сколько событий в каждый из последних days дней (created — unix-время)
func perDay(query string, since int64, days int) ([]int64, error) {
	out := make([]int64, days)
	start := since - since%86400
	rows, err := all(db, query, start)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		if i := (r.Int("created") - start) / 86400; i >= 0 && i < int64(days) {
			out[i]++
		}
	}
	return out, nil
}

// globalTop — общий топ сервера и рейтинг слушателей месяца по синхронизированной статистике всех
func globalTop() (M, error) {
	topMu.Lock()
	defer topMu.Unlock()
	if topV != nil && time.Since(topAt) < time.Minute {
		return topV, nil
	}
	month := time.Now().Format("2006-01")
	tracks := &statTracks{byKey: map[string]*statTrack{}}
	artists := &artistSec{sec: map[string]float64{}}
	users := map[int64]float64{}
	var userOrder []int64
	var total float64

	rows, err := db.Query("SELECT user_id, data FROM docs WHERE kind = 'stats'")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var uid int64
		var data string
		if err := rows.Scan(&uid, &data); err != nil {
			return nil, err
		}
		doc, ok := asObject(json.RawMessage(data))
		if !ok {
			continue
		}
		for _, p := range ordered(doc["days"]) {
			var sec float64
			if json.Unmarshal(p.val, &sec) != nil {
				continue
			}
			total += sec
			if strings.HasPrefix(p.key, month) {
				if _, seen := users[uid]; !seen {
					userOrder = append(userOrder, uid)
				}
				users[uid] += sec
			}
		}
		for _, p := range ordered(doc["tracks"]) {
			sec := tracks.add(uid, p.key, p.val)
			if o, ok := asObject(p.val); ok {
				if tr, ok := asObject(o["t"]); ok {
					artists.add(text(tr["artist"]), sec)
				}
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	names := map[int64]Row{}
	people, err := all(db, "SELECT id, login, name, avatar_at FROM users")
	if err != nil {
		return nil, err
	}
	for _, p := range people {
		names[p.Int("id")] = p
	}
	sort.SliceStable(userOrder, func(i, j int) bool { return users[userOrder[i]] > users[userOrder[j]] })
	leaders := []M{}
	for _, u := range userOrder[:min(10, len(userOrder))] {
		if p, ok := names[u]; ok {
			leaders = append(leaders, M{"id": u, "login": p.Str("login"), "name": p.Str("name"), "avatar": p.Int("avatar_at"),
				"sec": roundHalfEven(users[u])})
		}
	}
	topV = M{"total": roundHalfEven(total), "tracks": topTracks(tracks.top(10), true), "artists": artists.top(24), "leaders": leaders}
	topAt = time.Now()
	return topV, nil
}

func adminOverview(r *http.Request, me Auth) (any, error) {
	t := now()
	day, week := t-86400, t-7*86400
	var firstErr error
	c := func(query string, args ...any) int64 {
		n, err := count(db, query, args...)
		if err != nil && firstErr == nil {
			firstErr = err
		}
		return n
	}
	users := M{
		"total":       c("SELECT COUNT(*) FROM users"),
		"today":       c("SELECT COUNT(*) FROM users WHERE created >= ?", day),
		"week":        c("SELECT COUNT(*) FROM users WHERE created >= ?", week),
		"active_day":  c("SELECT COUNT(DISTINCT user_id) FROM sessions WHERE last_used >= ?", day),
		"active_week": c("SELECT COUNT(DISTINCT user_id) FROM sessions WHERE last_used >= ?", week),
		"banned":      c("SELECT COUNT(*) FROM users WHERE banned = 1"),
	}
	stats := M{
		"sessions":     c("SELECT COUNT(*) FROM sessions"),
		"friendships":  c("SELECT COUNT(*) FROM friends") / 2,
		"requests":     c("SELECT COUNT(*) FROM friend_requests"),
		"messages":     c("SELECT COUNT(*) FROM messages"),
		"messages_day": c("SELECT COUNT(*) FROM messages WHERE created >= ?", day),
		"shares":       c("SELECT COUNT(*) FROM shares"),
	}
	if firstErr != nil {
		return nil, firstErr
	}
	listening, err := all(db, "SELECT u.id, u.login, u.name, u.avatar_at, n.track, n.playing, n.pos, n.at FROM nowplaying n "+
		"JOIN users u ON u.id = n.user_id WHERE n.at >= ? ORDER BY n.at DESC LIMIT 50", (t-liveFor)*1000)
	if err != nil {
		return nil, err
	}
	series := M{}
	for key, table := range map[string]string{"users": "users", "messages": "messages"} {
		if series[key], err = perDay("SELECT created FROM "+table+" WHERE created >= ?", t-29*86400, 30); err != nil {
			return nil, err
		}
	}
	top, err := globalTop()
	if err != nil {
		return nil, err
	}
	online := []M{}
	for _, l := range listening {
		online = append(online, M{"id": l.Int("id"), "login": l.Str("login"), "name": l.Str("name"), "avatar": l.Int("avatar_at"),
			"playing": l.Int("playing") != 0, "pos": l.Float("pos"), "at": l.Int("at"), "track": json.RawMessage(l.Str("track"))})
	}

	snap := roomsSnapshot()
	people := map[int64]Row{}
	if len(snap) > 0 {
		rows, err := all(db, "SELECT id, name, avatar_at FROM users")
		if err != nil {
			return nil, err
		}
		for _, p := range rows {
			people[p.Int("id")] = p
		}
	}
	rooms := []M{}
	for _, rm := range snap {
		members := []M{}
		for _, m := range rm.members {
			name, avatar := m.name, int64(0)
			if p, ok := people[m.userID]; ok {
				name, avatar = p.Str("name"), p.Int("avatar_at")
			}
			members = append(members, M{"id": m.userID, "name": name, "avatar": avatar})
		}
		st, _ := asObject(rm.state)
		var track any
		if truthy(st["track"]) {
			track = st["track"]
		}
		rooms = append(rooms, M{"code": rm.code, "members": members, "track": track, "playing": truthy(st["playing"])})
	}
	var size int64
	if fi, err := os.Stat(dbPath); err == nil {
		size = fi.Size()
	}
	return M{"users": users, "online": online, "rooms": rooms, "stats": stats, "db_size": size, "now": t,
		"now_ms": nowMs(), "series": series, "top": top, "uptime": t - started}, nil
}

func adminUsers(r *http.Request, me Auth) (any, error) {
	q := r.URL.Query()
	limit := int64(100)
	if s := q.Get("limit"); s != "" {
		n, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			return nil, errFormat
		}
		limit = max(1, min(n, 500))
	}
	like := "%" + strings.ToLower(strings.TrimSpace(q.Get("q"))) + "%"
	rows, err := all(db, "SELECT u.id, u.login, u.name, u.created, u.banned, u.avatar_at, "+
		"(SELECT MAX(last_used) FROM sessions s WHERE s.user_id = u.id) AS last_seen, "+
		"(SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS sessions, "+
		"(SELECT COUNT(*) FROM friends f WHERE f.user_id = u.id) AS friends "+
		"FROM users u WHERE lower(u.login) LIKE ? OR lower(u.name) LIKE ? "+
		"ORDER BY COALESCE(last_seen, u.created) DESC LIMIT ?", like, like, limit)
	if err != nil {
		return nil, err
	}
	out := []M{}
	for _, u := range rows {
		var lastSeen any
		if !u.Null("last_seen") {
			lastSeen = u.Int("last_seen")
		}
		out = append(out, M{"id": u.Int("id"), "login": u.Str("login"), "name": u.Str("name"), "created": u.Int("created"),
			"banned": u.Int("banned") != 0, "avatar_at": u.Int("avatar_at"), "last_seen": lastSeen,
			"sessions": u.Int("sessions"), "friends": u.Int("friends"), "admin": isAdmin(u.Str("login"))})
	}
	return M{"users": out}, nil
}

func target(q querier, r *http.Request) (Row, error) {
	id, err := pathInt(r, "id")
	if err != nil {
		return nil, err
	}
	row, err := one(q, "SELECT id, login FROM users WHERE id = ?", id)
	if err == nil && row == nil {
		err = fail(404, "Нет такого пользователя")
	}
	return row, err
}

func adminKick(r *http.Request, me Auth) (any, error) {
	u, err := target(db, r)
	if err != nil {
		return nil, err
	}
	res, err := db.Exec("DELETE FROM sessions WHERE user_id = ?", u.Int("id"))
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	return M{"closed": n}, nil
}

type banBody struct {
	Banned *bool `json:"banned"`
}

func (b *banBody) check() error {
	if b.Banned == nil {
		return errFormat
	}
	return nil
}

func adminBan(r *http.Request, me Auth) (any, error) {
	var b banBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	err := tx(func(q *sql.Tx) error {
		u, err := target(q, r)
		if err != nil {
			return err
		}
		id := u.Int("id")
		if *b.Banned && (id == me.UserID || isAdmin(u.Str("login"))) {
			return fail(400, "Админа заблокировать нельзя")
		}
		banned := 0
		if *b.Banned {
			banned = 1
		}
		if _, err := q.Exec("UPDATE users SET banned = ? WHERE id = ?", banned, id); err != nil {
			return err
		}
		if *b.Banned {
			if _, err := q.Exec("DELETE FROM sessions WHERE user_id = ?", id); err != nil {
				return err
			}
			if _, err := q.Exec("DELETE FROM nowplaying WHERE user_id = ?", id); err != nil {
				return err
			}
		}
		return nil
	})
	return M{"ok": true}, err
}

func adminRename(r *http.Request, me Auth) (any, error) {
	var b nameBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(*b.Name)
	if name == "" {
		return nil, fail(400, "Имя не может быть пустым")
	}
	u, err := target(db, r)
	if err != nil {
		return nil, err
	}
	_, err = db.Exec("UPDATE users SET name = ? WHERE id = ?", name, u.Int("id"))
	return M{"ok": true}, err
}

type announceBody struct {
	Text  string          `json:"text"`
	Track json.RawMessage `json:"track"` // «трек дня»: у всех в баннере кнопка ▶
}

func (b *announceBody) check() error {
	if _, ok := asObject(b.Track); tooLong(b.Text, 500) || (!isNull(b.Track) && !ok) {
		return errFormat
	}
	return nil
}

func setSetting(key string, value any) error {
	v, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = db.Exec("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", key, string(v))
	return err
}

func adminAnnounce(r *http.Request, me Auth) (any, error) {
	var b announceBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	txt := strings.TrimSpace(b.Text)
	if txt == "" {
		_, err := db.Exec("DELETE FROM settings WHERE key = 'announce'")
		return M{"ok": true}, err
	}
	var track any
	if !isNull(b.Track) {
		track = b.Track
	}
	return M{"ok": true}, setSetting("announce", M{"id": nowMs(), "text": txt, "track": track})
}

type notifyBody struct {
	Text *string `json:"text"`
}

func (b *notifyBody) check() error {
	if b.Text == nil || tooLong(*b.Text, 500) {
		return errFormat
	}
	return nil
}

func adminNotify(r *http.Request, me Auth) (any, error) {
	var b notifyBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	txt := strings.TrimSpace(*b.Text)
	if txt == "" {
		return nil, fail(400, "Пустое уведомление")
	}
	u, err := target(db, r)
	if err != nil {
		return nil, err
	}
	by, err := getUser(db, me.UserID)
	if err != nil {
		return nil, err
	}
	return M{"ok": true}, setSetting("notice:"+itoa(u.Int("id")), M{"id": nowMs(), "text": txt, "by": by.Str("name")})
}

func announceGet(r *http.Request, me Auth) (any, error) {
	out := M{"announce": nil, "notice": nil}
	for key, name := range map[string]string{"announce": "announce", "notice": "notice:" + itoa(me.UserID)} {
		row, err := one(db, "SELECT value FROM settings WHERE key = ?", name)
		if err != nil {
			return nil, err
		}
		if row != nil {
			out[key] = json.RawMessage(row.Str("value"))
		}
	}
	return out, nil
}
