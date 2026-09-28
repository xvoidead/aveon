// Друзья и «что слушает друг».
//
// Дружба — по логину: один отправляет заявку, второй принимает. Если оба отправили заявки друг другу,
// дружба начинается сразу. Плеер сообщает серверу, что у него играет, и раз в минуту напоминает;
// друзья видят трек, паузу и позицию. Кто давно не напоминал — не в сети, виден только последний трек.
//
//	GET    /api/friends                     → {friends, incoming, outgoing, invites, knocks, now}
//	POST   /api/friends          {login}    → {status: "sent" | "friends"}
//	POST   /api/friends/{id}/accept         → {ok}
//	DELETE /api/friends/{id}                → {ok}   удалить из друзей, отклонить или отозвать заявку
//	PUT    /api/now    {track, playing, pos} → {ok}  track: null — ничего не играет
//	POST   /api/friends/{id}/invite {code}  → {ok}   позвать друга в руму
//	DELETE /api/friends/{id}/invite         → {ok}   убрать приглашение от друга (вошёл или отказался)
//	POST   /api/friends/{id}/knock          → {ok}   попроситься в руму к другу (он сейчас в руме)
//	DELETE /api/friends/{id}/knock          → {ok}   убрать просьбу друга (пустил или отказал)
//	GET    /api/friends/{id}/profile        → {user, now, in_room, stats, server_now}
//
// Приглашения и просьбы живут в памяти 10 минут и пропадают, когда рума закрылась.
package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	maxFriends  = 200
	maxOutgoing = 50        // висящих заявок от одного человека
	maxTrack    = 16 * 1024 // JSON трека
	liveFor     = 150       // с без напоминаний — плеер закрыт
	inviteFor   = 10 * 60   // с
	topN        = 8
)

type invite struct {
	code string
	at   float64
}

var (
	invitesMu sync.Mutex
	invites   = map[int64]map[int64]invite{}  // кому → от кого → {code, at}
	knocks    = map[int64]map[int64]float64{} // кому → кто просится → когда
)

func unixF() float64 { return float64(time.Now().UnixNano()) / 1e9 }

// freshInvitesLocked — приглашения пользователю без устаревших и без закрытых рум
func freshInvitesLocked(userID int64) map[int64]invite {
	t := unixF()
	mine := invites[userID]
	for s, inv := range mine {
		if t-inv.at > inviteFor || !roomExists(inv.code) {
			delete(mine, s)
		}
	}
	if len(mine) == 0 {
		delete(invites, userID)
	}
	return mine
}

func freshKnocksLocked(userID int64, busy map[int64]bool) map[int64]float64 {
	mine := knocks[userID]
	t := unixF()
	for s, at := range mine {
		if !busy[userID] || t-at > inviteFor {
			delete(mine, s)
		}
	}
	if len(mine) == 0 {
		delete(knocks, userID)
	}
	return mine
}

// pruneInvites — из обслуживания: иначе приглашения тем, кто больше не заходил, копятся в памяти
func pruneInvites() {
	busy := usersInRooms()
	invitesMu.Lock()
	defer invitesMu.Unlock()
	for id := range invites {
		freshInvitesLocked(id)
	}
	for id := range knocks {
		freshKnocksLocked(id, busy)
	}
}

func person(r Row) M {
	return M{"id": r.Int("id"), "login": r.Str("login"), "name": r.Str("name"), "avatar": r.Int("avatar_at")}
}

func with(m M, extra M) M {
	for k, v := range extra {
		m[k] = v
	}
	return m
}

func areFriends(q querier, a, b int64) (bool, error) {
	return exists(q, "SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?", a, b)
}

func makeFriends(q querier, a, b int64) error {
	t := now()
	if _, err := q.Exec("DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)", a, b, b, a); err != nil {
		return err
	}
	_, err := q.Exec("INSERT OR IGNORE INTO friends (user_id, friend_id, since) VALUES (?, ?, ?), (?, ?, ?)", a, b, t, b, a, t)
	return err
}

func friendCount(q querier, id int64) (int64, error) {
	return count(q, "SELECT COUNT(*) FROM friends WHERE user_id = ?", id)
}

// nowView — что играет: live — плеер напоминал недавно; иначе виден только последний трек
func nowView(r Row, t int64) any {
	if r.Null("track") {
		return nil
	}
	live := t-r.Int("at") < liveFor*1000
	return M{"track": json.RawMessage(r.Str("track")), "playing": r.Int("playing") != 0 && live,
		"pos": r.Float("pos"), "at": r.Int("at"), "live": live}
}

func friendsList(r *http.Request, me Auth) (any, error) {
	t := nowMs()
	friends, err := all(db,
		"SELECT u.id, u.login, u.name, u.avatar_at, f.since, n.track, n.playing, n.pos, n.at "+
			"FROM friends f JOIN users u ON u.id = f.friend_id LEFT JOIN nowplaying n ON n.user_id = u.id "+
			"WHERE f.user_id = ?", me.UserID)
	if err != nil {
		return nil, err
	}
	incoming, err := all(db, "SELECT u.id, u.login, u.name, u.avatar_at, r.created FROM friend_requests r "+
		"JOIN users u ON u.id = r.from_id WHERE r.to_id = ? ORDER BY r.created DESC", me.UserID)
	if err != nil {
		return nil, err
	}
	outgoing, err := all(db, "SELECT u.id, u.login, u.name, u.avatar_at, r.created FROM friend_requests r "+
		"JOIN users u ON u.id = r.to_id WHERE r.from_id = ? ORDER BY r.created DESC", me.UserID)
	if err != nil {
		return nil, err
	}

	busy := usersInRooms()
	invitesMu.Lock()
	type inv struct {
		id   int64
		code string
		at   float64
	}
	var myInvites, myKnocks []inv
	for s, v := range freshInvitesLocked(me.UserID) {
		myInvites = append(myInvites, inv{s, v.code, v.at})
	}
	for s, at := range freshKnocksLocked(me.UserID, busy) {
		myKnocks = append(myKnocks, inv{s, "", at})
	}
	invitesMu.Unlock()
	sort.Slice(myInvites, func(i, j int) bool { return myInvites[i].at > myInvites[j].at })
	sort.Slice(myKnocks, func(i, j int) bool { return myKnocks[i].at > myKnocks[j].at })

	senders := map[int64]Row{}
	var ids []any
	for _, x := range append(append([]inv{}, myInvites...), myKnocks...) {
		ids = append(ids, x.id)
	}
	if len(ids) > 0 {
		rows, err := all(db, "SELECT id, login, name, avatar_at FROM users WHERE id IN ("+placeholders(len(ids))+")", ids...)
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			senders[r.Int("id")] = r
		}
	}

	unread, err := unreadByFriend(db, me.UserID)
	if err != nil {
		return nil, err
	}
	reacts, err := reactionsToMe(db, me.UserID)
	if err != nil {
		return nil, err
	}

	items := []M{}
	for _, f := range friends {
		id := f.Int("id")
		var last, react any
		var n int64
		if u, ok := unread[id]; ok {
			n, last = u.n, u.last
		}
		if x, ok := reacts[id]; ok {
			react = x
		}
		items = append(items, with(person(f), M{"since": f.Int("since"), "now": nowView(f, t), "in_room": busy[id],
			"unread": n, "last": last, "react": react}))
	}
	// сверху — кто слушает прямо сейчас, потом кто в сети, потом по времени последнего трека
	flags := func(m M) (playing, live bool, at int64) {
		if n, ok := m["now"].(M); ok {
			return n["playing"].(bool), n["live"].(bool), n["at"].(int64)
		}
		return
	}
	sort.SliceStable(items, func(i, j int) bool {
		pi, li, ai := flags(items[i])
		pj, lj, aj := flags(items[j])
		if pi != pj {
			return pi
		}
		if li != lj {
			return li
		}
		if ai != aj {
			return ai > aj
		}
		return strings.ToLower(items[i]["name"].(string)) < strings.ToLower(items[j]["name"].(string))
	})

	inList, knockList := []M{}, []M{}
	for _, x := range myInvites {
		if s, ok := senders[x.id]; ok {
			inList = append(inList, with(person(s), M{"code": x.code, "at": int64(x.at)}))
		}
	}
	for _, x := range myKnocks {
		if s, ok := senders[x.id]; ok {
			knockList = append(knockList, with(person(s), M{"at": int64(x.at)}))
		}
	}
	requests := func(rows []Row) []M {
		out := []M{}
		for _, r := range rows {
			out = append(out, with(person(r), M{"created": r.Int("created")}))
		}
		return out
	}
	return M{"friends": items, "incoming": requests(incoming), "outgoing": requests(outgoing),
		"invites": inList, "knocks": knockList, "now": t}, nil
}

type loginRef struct {
	Login *string `json:"login"`
}

func (b *loginRef) check() error {
	if b.Login == nil || tooLong(*b.Login, 64) {
		return errFormat
	}
	return nil
}

func friendsAdd(r *http.Request, me Auth) (any, error) {
	var b loginRef
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	login := strings.ToLower(strings.TrimLeft(strings.TrimSpace(*b.Login), "@"))
	if login == "" {
		return nil, fail(400, "Впиши логин друга")
	}
	status := "sent"
	err := tx(func(q *sql.Tx) error {
		other, err := one(q, "SELECT id FROM users WHERE login = ?", login)
		if err != nil {
			return err
		}
		if other == nil {
			return fail(404, "Нет пользователя с логином @"+login)
		}
		oid := other.Int("id")
		if oid == me.UserID {
			return fail(400, "Это твой собственный логин")
		}
		if ok, err := areFriends(q, me.UserID, oid); err != nil || ok {
			if err == nil {
				err = fail(409, "Вы уже друзья")
			}
			return err
		}
		if n, err := friendCount(q, me.UserID); err != nil || n >= maxFriends {
			if err == nil {
				err = fail(400, "Друзей может быть не больше 200")
			}
			return err
		}
		// он уже звал нас — значит, просто принимаем
		if ok, err := exists(q, "SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?", oid, me.UserID); err != nil || ok {
			if err != nil {
				return err
			}
			if n, err := friendCount(q, oid); err != nil || n >= maxFriends {
				if err == nil {
					err = fail(400, "У друга уже слишком много друзей")
				}
				return err
			}
			status = "friends"
			return makeFriends(q, me.UserID, oid)
		}
		if ok, err := exists(q, "SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?", me.UserID, oid); err != nil || ok {
			return err
		}
		if n, err := count(q, "SELECT COUNT(*) FROM friend_requests WHERE from_id = ?", me.UserID); err != nil || n >= maxOutgoing {
			if err == nil {
				err = fail(429, "Слишком много заявок ждут ответа. Отзови старые")
			}
			return err
		}
		_, err = q.Exec("INSERT INTO friend_requests (from_id, to_id, created) VALUES (?, ?, ?)", me.UserID, oid, now())
		return err
	})
	if err != nil {
		return nil, err
	}
	return M{"status": status}, nil
}

func friendsAccept(r *http.Request, me Auth) (any, error) {
	id, err := pathInt(r, "id")
	if err != nil {
		return nil, err
	}
	err = tx(func(q *sql.Tx) error {
		if ok, err := exists(q, "SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?", id, me.UserID); err != nil || !ok {
			if err == nil {
				err = fail(404, "Заявки уже нет")
			}
			return err
		}
		a, err := friendCount(q, me.UserID)
		if err != nil {
			return err
		}
		b, err := friendCount(q, id)
		if err != nil {
			return err
		}
		if a >= maxFriends || b >= maxFriends {
			return fail(400, "Друзей может быть не больше 200")
		}
		return makeFriends(q, me.UserID, id)
	})
	return M{"ok": true}, err
}

func friendsRemove(r *http.Request, me Auth) (any, error) {
	id, err := pathInt(r, "id")
	if err != nil {
		return nil, err
	}
	a, b := me.UserID, id
	err = tx(func(q *sql.Tx) error {
		if _, err := q.Exec("DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)", a, b, b, a); err != nil {
			return err
		}
		_, err := q.Exec("DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)", a, b, b, a)
		return err
	})
	return M{"ok": true}, err
}

type inviteBody struct {
	Code *string `json:"code"`
}

func (b *inviteBody) check() error {
	if b.Code == nil || tooLong(*b.Code, 16) {
		return errFormat
	}
	return nil
}

func friendsInvite(r *http.Request, me Auth) (any, error) {
	id, err := pathInt(r, "id")
	if err != nil {
		return nil, err
	}
	var b inviteBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	code := strings.ToUpper(strings.TrimSpace(*b.Code))
	if !roomExists(code) {
		return nil, fail(404, "Рума уже закрылась")
	}
	if ok, err := areFriends(db, me.UserID, id); err != nil || !ok {
		if err == nil {
			err = fail(403, "Звать в руму можно только друзей")
		}
		return nil, err
	}
	invitesMu.Lock()
	if invites[id] == nil {
		invites[id] = map[int64]invite{}
	}
	invites[id][me.UserID] = invite{code, unixF()}
	delete(knocks[me.UserID], id) // он просился — считаем, что пустили
	invitesMu.Unlock()
	return M{"ok": true}, nil
}

func friendsInviteDismiss(r *http.Request, me Auth) (any, error) {
	id, err := pathInt(r, "id")
	if err != nil {
		return nil, err
	}
	invitesMu.Lock()
	delete(invites[me.UserID], id)
	invitesMu.Unlock()
	return M{"ok": true}, nil
}

func friendsKnock(r *http.Request, me Auth) (any, error) {
	id, err := pathInt(r, "id")
	if err != nil {
		return nil, err
	}
	if ok, err := areFriends(db, me.UserID, id); err != nil || !ok {
		if err == nil {
			err = fail(403, "Проситься можно только к друзьям")
		}
		return nil, err
	}
	if !usersInRooms()[id] {
		return nil, fail(404, "Друг уже не в руме")
	}
	invitesMu.Lock()
	if knocks[id] == nil {
		knocks[id] = map[int64]float64{}
	}
	knocks[id][me.UserID] = unixF()
	invitesMu.Unlock()
	return M{"ok": true}, nil
}

func friendsKnockDismiss(r *http.Request, me Auth) (any, error) {
	id, err := pathInt(r, "id")
	if err != nil {
		return nil, err
	}
	invitesMu.Lock()
	delete(knocks[me.UserID], id)
	invitesMu.Unlock()
	return M{"ok": true}, nil
}

type nowBody struct {
	Track   json.RawMessage `json:"track"`
	Playing bool            `json:"playing"`
	Pos     float64         `json:"pos"`
}

func (b *nowBody) check() error {
	if b.Pos < 0 || b.Pos > 24*3600 {
		return errFormat
	}
	if _, ok := asObject(b.Track); !isNull(b.Track) && !ok {
		return errFormat
	}
	return nil
}

func nowPut(r *http.Request, me Auth) (any, error) {
	var b nowBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	if isNull(b.Track) {
		_, err := db.Exec("DELETE FROM nowplaying WHERE user_id = ?", me.UserID)
		return M{"ok": true}, err
	}
	track, err := compact(b.Track)
	if err != nil {
		return nil, err
	}
	t, _ := asObject(b.Track)
	if len(track) > maxTrack || strings.TrimSpace(text(t["title"])) == "" {
		return nil, fail(400, "Неверный трек")
	}
	playing := 0
	if b.Playing {
		playing = 1
	}
	_, err = db.Exec("INSERT INTO nowplaying (user_id, track, playing, pos, at) VALUES (?, ?, ?, ?, ?) "+
		"ON CONFLICT (user_id) DO UPDATE SET track = excluded.track, playing = excluded.playing, pos = excluded.pos, at = excluded.at",
		me.UserID, track, playing, b.Pos, nowMs())
	return M{"ok": true}, err
}

// ---------- профиль друга ----------
// Сводка по статистике прослушивания, которую плееры и так синхронизируют (docs kind=stats, по компьютеру).
// Отдаётся только друзьям и только сводка: сколько слушал и что чаще всего

// trackKeep — поля трека, которые уходят в топы: без путей к файлам и прочего
var trackKeep = []string{"id", "source", "title", "artist", "album", "duration", "cover", "link", "ref"}

func slim(t obj) M {
	out := M{}
	for _, k := range trackKeep {
		if v, ok := t[k]; ok {
			out[k] = v
		}
	}
	return out
}

type statTrack struct {
	track obj
	sec   float64
	plays int64
	users map[int64]bool
}

// statTracks — треки из статистики в порядке первого появления: сек, прослушивания, кто слушал
type statTracks struct {
	order []string
	byKey map[string]*statTrack
}

func (s *statTracks) add(userID int64, key string, raw json.RawMessage) float64 {
	t, ok := asObject(raw)
	if !ok {
		return 0
	}
	tr, ok := asObject(t["t"])
	if !ok {
		return 0
	}
	sec, _ := number(t["sec"])
	plays, _ := number(t["plays"])
	cur := s.byKey[key]
	if cur == nil {
		cur = &statTrack{track: tr, users: map[int64]bool{}}
		s.byKey[key] = cur
		s.order = append(s.order, key)
	}
	cur.sec += sec
	cur.plays += int64(plays)
	cur.users[userID] = true
	return sec
}

func (s *statTracks) top(n int) []*statTrack {
	var list []*statTrack
	for _, k := range s.order {
		list = append(list, s.byKey[k])
	}
	sort.SliceStable(list, func(i, j int) bool { return list[i].sec > list[j].sec })
	if len(list) > n {
		list = list[:n]
	}
	return list
}

// artistSec — секунды по исполнителям («A, B» — оба) в порядке первого появления
type artistSec struct {
	order []string
	sec   map[string]float64
}

func (a *artistSec) add(artist string, sec float64) {
	for _, name := range strings.Split(artist, ",") {
		if name = strings.TrimSpace(name); name != "" {
			if _, ok := a.sec[name]; !ok {
				a.order = append(a.order, name)
			}
			a.sec[name] += sec
		}
	}
}

func (a *artistSec) top(n int) []M {
	names := append([]string(nil), a.order...)
	sort.SliceStable(names, func(i, j int) bool { return a.sec[names[i]] > a.sec[names[j]] })
	if len(names) > n {
		names = names[:n]
	}
	out := []M{}
	for _, name := range names {
		out = append(out, M{"name": name, "sec": roundHalfEven(a.sec[name])})
	}
	return out
}

func topTracks(list []*statTrack, withUsers bool) []M {
	out := []M{}
	for _, x := range list {
		m := M{"track": slim(x.track), "sec": roundHalfEven(x.sec), "plays": x.plays}
		if withUsers {
			m["users"] = len(x.users)
		}
		out = append(out, m)
	}
	return out
}

// Разбирать JSON до 5 МБ на каждый компьютер при каждом открытии профиля дорого. Ключ кеша —
// пользователь, ревизии его stats-документов и месяц: изменилась статистика — считаем заново
type summaryEntry struct {
	revs, month string
	summary     M
}

var (
	summaryMu    sync.Mutex
	summaryCache = map[int64]summaryEntry{}
)

const summaryCacheMax = 256

func statsSummary(userID int64, month string) (M, error) {
	revRows, err := all(db, "SELECT key, rev FROM docs WHERE user_id = ? AND kind = 'stats' ORDER BY key", userID)
	if err != nil {
		return nil, err
	}
	var rb strings.Builder
	for _, r := range revRows {
		rb.WriteString(r.Str("key") + ":" + itoa(r.Int("rev")) + ";")
	}
	revs := rb.String()
	summaryMu.Lock()
	hit, ok := summaryCache[userID]
	summaryMu.Unlock()
	if ok && hit.revs == revs && hit.month == month {
		return hit.summary, nil
	}

	docs, err := all(db, "SELECT data FROM docs WHERE user_id = ? AND kind = 'stats'", userID)
	if err != nil {
		return nil, err
	}
	var total, monthSec float64
	days := map[string]bool{}
	tracks := &statTracks{byKey: map[string]*statTrack{}}
	for _, d := range docs {
		data, ok := asObject(json.RawMessage(d.Str("data")))
		if !ok {
			continue
		}
		for _, p := range ordered(data["days"]) {
			var sec float64
			if json.Unmarshal(p.val, &sec) == nil && sec > 0 {
				total += sec
				days[p.key] = true
				if strings.HasPrefix(p.key, month) {
					monthSec += sec
				}
			}
		}
		for _, p := range ordered(data["tracks"]) {
			tracks.add(userID, p.key, p.val)
		}
	}
	artists := &artistSec{sec: map[string]float64{}}
	for _, k := range tracks.order {
		t := tracks.byKey[k]
		artists.add(text(t.track["artist"]), t.sec)
	}
	summary := M{"total": roundHalfEven(total), "month": roundHalfEven(monthSec), "days": len(days),
		"tracks": topTracks(tracks.top(topN), false), "artists": artists.top(topN)}

	summaryMu.Lock()
	if len(summaryCache) >= summaryCacheMax {
		clear(summaryCache)
	}
	summaryCache[userID] = summaryEntry{revs, month, summary}
	summaryMu.Unlock()
	return summary, nil
}

func friendsProfile(r *http.Request, me Auth) (any, error) {
	id, err := pathInt(r, "id")
	if err != nil {
		return nil, err
	}
	month := time.Now().Format("2006-01")
	u, err := one(db, "SELECT u.id, u.login, u.name, u.avatar_at, u.created, f.since FROM users u "+
		"JOIN friends f ON f.friend_id = u.id AND f.user_id = ? WHERE u.id = ?", me.UserID, id)
	if err != nil {
		return nil, err
	}
	if u == nil {
		return nil, fail(403, "Профиль виден только друзьям")
	}
	stats, err := statsSummary(id, month)
	if err != nil {
		return nil, err
	}
	np, err := one(db, "SELECT track, playing, pos, at FROM nowplaying WHERE user_id = ?", id)
	if err != nil {
		return nil, err
	}
	t := nowMs()
	var nowAny any
	if np != nil {
		nowAny = nowView(np, t)
	}
	return M{"user": with(person(u), M{"since": u.Int("since"), "created": u.Int("created")}),
		"now": nowAny, "in_room": usersInRooms()[id], "stats": stats, "server_now": t}, nil
}
