// Совместные плейлисты: несколько человек добавляют треки по коду. В отличие от «поделиться» (share.go)
// плейлист живой — правки видны всем участникам. Клиент опрашивает GET /api/collab/{code} раз в 15 с,
// пока плейлист открыт, и перерисовывает список, когда меняется rev.
//
//	POST  /api/collab                 {title, tracks}  → {code}            создатель сразу участник
//	GET   /api/collab                                  → [{code, title, count, members, updated, rev}]  где я участник
//	GET   /api/collab/{code}                           → {code, title, owner, rev, updated, members, tracks}
//	POST  /api/collab/{code}/join                      → то же, что GET
//	POST  /api/collab/{code}/tracks   {tracks}         → {rev}   в конец, дубликаты по id пропускаются
//	POST  /api/collab/{code}/remove   {ids}            → {rev}   удалить может тот, кто добавил, или владелец
//	POST  /api/collab/{code}/move     {id, before}     → {rev}   before — id трека или null (в конец)
//	PATCH /api/collab/{code}          {title}          → {rev}   только владелец
//	POST  /api/collab/{code}/leave                     → {}      ушёл владелец — плейлист самому раннему участнику;
//	                                                              участников нет — плейлист удаляется
package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
)

const (
	collabMaxMembers = 20
	collabMaxTracks  = 2000
	collabMaxTrack   = 8 * 1024 // JSON снимка одного трека
	collabNotFound   = "Такого плейлиста нет. Проверь код"
)

type createBody struct {
	Title  *string           `json:"title"`
	Tracks []json.RawMessage `json:"tracks"`
}

func (b *createBody) check() error {
	if b.Title == nil || tooLong(*b.Title, 100) || !allObjects(b.Tracks) {
		return errFormat
	}
	return nil
}

type tracksBody struct {
	Tracks []json.RawMessage `json:"tracks"`
}

func (b *tracksBody) check() error {
	if b.Tracks == nil || !allObjects(b.Tracks) {
		return errFormat
	}
	return nil
}

type removeBody struct {
	IDs []string `json:"ids"`
}

func (b *removeBody) check() error {
	if b.IDs == nil {
		return errFormat
	}
	return nil
}

type moveBody struct {
	ID     *string `json:"id"`
	Before *string `json:"before"`
}

func (b *moveBody) check() error {
	if b.ID == nil {
		return errFormat
	}
	return nil
}

type titleBody struct {
	Title *string `json:"title"`
}

func (b *titleBody) check() error {
	if b.Title == nil || tooLong(*b.Title, 100) {
		return errFormat
	}
	return nil
}

func allObjects(list []json.RawMessage) bool {
	for _, v := range list {
		if _, ok := asObject(v); !ok {
			return false
		}
	}
	return true
}

func cleanTitle(title string) (string, error) {
	if title = strings.TrimSpace(title); title == "" {
		return "", fail(400, "Назови плейлист")
	}
	return title, nil
}

type snapshot struct{ id, data string }

// snapshots проверяет каждый трек: есть id и название, снимок не больше 8 КБ
func snapshots(tracks []json.RawMessage) ([]snapshot, error) {
	var out []snapshot
	for _, raw := range tracks {
		t, _ := asObject(raw)
		id := strings.TrimSpace(text(t["id"]))
		if id == "" || strings.TrimSpace(text(t["title"])) == "" {
			return nil, fail(400, "У трека нет id или названия")
		}
		data, err := compact(raw)
		if err != nil {
			return nil, err
		}
		if len(data) > collabMaxTrack {
			return nil, fail(413, "Трек «"+text(t["title"])+"» слишком большой")
		}
		out = append(out, snapshot{id, data})
	}
	return out, nil
}

func findCollab(q querier, code string) (Row, error) {
	code = normCode(code)
	if !shareCodeRe.MatchString(code) {
		return nil, fail(404, collabNotFound)
	}
	row, err := one(q, "SELECT * FROM collabs WHERE code = ?", code)
	if err == nil && row == nil {
		err = fail(404, collabNotFound)
	}
	return row, err
}

func memberOf(q querier, code string, userID int64) (bool, error) {
	return exists(q, "SELECT 1 FROM collab_members WHERE code = ? AND user_id = ?", code, userID)
}

func mustMember(q querier, code string, userID int64) error {
	ok, err := memberOf(q, code, userID)
	if err == nil && !ok {
		err = fail(403, "Ты не в этом плейлисте — войди по коду")
	}
	return err
}

func bump(q querier, code string) (int64, error) {
	if _, err := q.Exec("UPDATE collabs SET rev = rev + 1, updated = ? WHERE code = ?", now(), code); err != nil {
		return 0, err
	}
	row, err := one(q, "SELECT rev FROM collabs WHERE code = ?", code)
	if err != nil {
		return 0, err
	}
	return row.Int("rev"), nil
}

// addTracks добавляет в конец, пропуская уже имеющиеся. Возвращает, сколько добавлено
func addTracks(q querier, code string, userID int64, tracks []json.RawMessage) (int, error) {
	snaps, err := snapshots(tracks)
	if err != nil {
		return 0, err
	}
	rows, err := all(q, "SELECT track_id FROM collab_tracks WHERE code = ?", code)
	if err != nil {
		return 0, err
	}
	have := map[string]bool{}
	for _, r := range rows {
		have[r.Str("track_id")] = true
	}
	var fresh []snapshot
	for _, s := range snaps {
		if !have[s.id] {
			have[s.id] = true
			fresh = append(fresh, s)
		}
	}
	if len(rows)+len(fresh) > collabMaxTracks {
		return 0, fail(400, "В плейлисте может быть не больше 2000 треков")
	}
	top, err := one(q, "SELECT COALESCE(MAX(pos), 0) AS top FROM collab_tracks WHERE code = ?", code)
	if err != nil {
		return 0, err
	}
	t := now()
	for i, s := range fresh {
		if _, err := q.Exec("INSERT INTO collab_tracks (code, track_id, data, added_by, added_at, pos) VALUES (?, ?, ?, ?, ?, ?)",
			code, s.id, s.data, userID, t, top.Float("top")+float64(i+1)); err != nil {
			return 0, err
		}
	}
	return len(fresh), nil
}

func collabView(q querier, row Row) (M, error) {
	code := row.Str("code")
	members, err := all(q, "SELECT u.id, u.name, u.avatar_at FROM collab_members m JOIN users u ON u.id = m.user_id "+
		"WHERE m.code = ? ORDER BY m.joined, u.id", code)
	if err != nil {
		return nil, err
	}
	tracks, err := all(q, "SELECT t.data, t.added_at, u.id AS by_id, u.name AS by_name FROM collab_tracks t "+
		"JOIN users u ON u.id = t.added_by WHERE t.code = ? ORDER BY t.pos", code)
	if err != nil {
		return nil, err
	}
	ms, ts := []M{}, []M{}
	for _, m := range members {
		ms = append(ms, M{"id": m.Int("id"), "name": m.Str("name"), "avatar_at": m.Int("avatar_at")})
	}
	for _, t := range tracks {
		o, _ := asObject(json.RawMessage(t.Str("data")))
		v := M{}
		for k, val := range o {
			v[k] = val
		}
		v["by"] = M{"id": t.Int("by_id"), "name": t.Str("by_name")}
		v["added_at"] = t.Int("added_at")
		ts = append(ts, v)
	}
	return M{"code": code, "title": row.Str("title"), "owner": row.Int("owner_id"), "rev": row.Int("rev"),
		"updated": row.Int("updated"), "members": ms, "tracks": ts}, nil
}

func collabCreate(r *http.Request, me Auth) (any, error) {
	var b createBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	title, err := cleanTitle(*b.Title)
	if err != nil {
		return nil, err
	}
	var code string
	err = tx(func(q *sql.Tx) error {
		var err error
		if code, err = newCode(q, "collabs"); err != nil {
			return err
		}
		t := now()
		if _, err := q.Exec("INSERT INTO collabs (code, owner_id, title, rev, created, updated) VALUES (?, ?, ?, 1, ?, ?)",
			code, me.UserID, title, t, t); err != nil {
			return err
		}
		if _, err := q.Exec("INSERT INTO collab_members (code, user_id, joined) VALUES (?, ?, ?)", code, me.UserID, t); err != nil {
			return err
		}
		_, err = addTracks(q, code, me.UserID, b.Tracks)
		return err
	})
	if err != nil {
		return nil, err
	}
	return M{"code": code}, nil
}

func collabMine(r *http.Request, me Auth) (any, error) {
	rows, err := all(db, "SELECT c.code, c.title, c.updated, c.rev, "+
		"(SELECT COUNT(*) FROM collab_tracks t WHERE t.code = c.code) AS count, "+
		"(SELECT COUNT(*) FROM collab_members x WHERE x.code = c.code) AS members "+
		"FROM collabs c JOIN collab_members m ON m.code = c.code AND m.user_id = ? ORDER BY c.updated DESC", me.UserID)
	if err != nil {
		return nil, err
	}
	out := []M{}
	for _, r := range rows {
		out = append(out, M{"code": r.Str("code"), "title": r.Str("title"), "updated": r.Int("updated"), "rev": r.Int("rev"),
			"count": r.Int("count"), "members": r.Int("members")})
	}
	return out, nil
}

func collabGet(r *http.Request, me Auth) (any, error) {
	row, err := findCollab(db, r.PathValue("code"))
	if err != nil {
		return nil, err
	}
	if err := mustMember(db, row.Str("code"), me.UserID); err != nil {
		return nil, err
	}
	return collabView(db, row)
}

func collabJoin(r *http.Request, me Auth) (any, error) {
	var out M
	err := tx(func(q *sql.Tx) error {
		row, err := findCollab(q, r.PathValue("code"))
		if err != nil {
			return err
		}
		code := row.Str("code")
		ok, err := memberOf(q, code, me.UserID)
		if err != nil {
			return err
		}
		if !ok {
			n, err := count(q, "SELECT COUNT(*) FROM collab_members WHERE code = ?", code)
			if err != nil {
				return err
			}
			if n >= collabMaxMembers {
				return fail(400, "В плейлисте уже 20 участников")
			}
			if _, err := q.Exec("INSERT INTO collab_members (code, user_id, joined) VALUES (?, ?, ?)", code, me.UserID, now()); err != nil {
				return err
			}
			if _, err := bump(q, code); err != nil {
				return err
			}
			if row, err = findCollab(q, code); err != nil {
				return err
			}
		}
		out, err = collabView(q, row)
		return err
	})
	return out, err
}

// collabEdit — общая обёртка правок: найти плейлист в транзакции и вернуть {rev}
func collabEdit(r *http.Request, fn func(q *sql.Tx, row Row) (int64, error)) (any, error) {
	var rev int64
	err := tx(func(q *sql.Tx) error {
		row, err := findCollab(q, r.PathValue("code"))
		if err != nil {
			return err
		}
		rev, err = fn(q, row)
		return err
	})
	if err != nil {
		return nil, err
	}
	return M{"rev": rev}, nil
}

func collabTracksAdd(r *http.Request, me Auth) (any, error) {
	var b tracksBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	return collabEdit(r, func(q *sql.Tx, row Row) (int64, error) {
		code := row.Str("code")
		if err := mustMember(q, code, me.UserID); err != nil {
			return 0, err
		}
		added, err := addTracks(q, code, me.UserID, b.Tracks)
		if err != nil || added == 0 {
			return row.Int("rev"), err
		}
		return bump(q, code)
	})
}

func collabRemove(r *http.Request, me Auth) (any, error) {
	var b removeBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	return collabEdit(r, func(q *sql.Tx, row Row) (int64, error) {
		code := row.Str("code")
		if err := mustMember(q, code, me.UserID); err != nil {
			return 0, err
		}
		if len(b.IDs) == 0 {
			return row.Int("rev"), nil
		}
		args := []any{code}
		for _, id := range b.IDs {
			args = append(args, id)
		}
		found, err := all(q, "SELECT track_id, added_by FROM collab_tracks WHERE code = ? AND track_id IN ("+placeholders(len(b.IDs))+")", args...)
		if err != nil {
			return 0, err
		}
		owner := row.Int("owner_id") == me.UserID
		allowed := []any{code}
		for _, f := range found {
			if owner || f.Int("added_by") == me.UserID {
				allowed = append(allowed, f.Str("track_id"))
			}
		}
		if len(found) > 0 && len(allowed) == 1 {
			return 0, fail(403, "Убрать трек может тот, кто его добавил, или владелец плейлиста")
		}
		if len(allowed) == 1 {
			return row.Int("rev"), nil
		}
		if _, err := q.Exec("DELETE FROM collab_tracks WHERE code = ? AND track_id IN ("+placeholders(len(allowed)-1)+")", allowed...); err != nil {
			return 0, err
		}
		return bump(q, code)
	})
}

func collabMove(r *http.Request, me Auth) (any, error) {
	var b moveBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	return collabEdit(r, func(q *sql.Tx, row Row) (int64, error) {
		code := row.Str("code")
		if err := mustMember(q, code, me.UserID); err != nil {
			return 0, err
		}
		rows, err := all(q, "SELECT track_id FROM collab_tracks WHERE code = ? ORDER BY pos", code)
		if err != nil {
			return 0, err
		}
		var order []string
		index := func(id string) int {
			for i, x := range order {
				if x == id {
					return i
				}
			}
			return -1
		}
		for _, r := range rows {
			order = append(order, r.Str("track_id"))
		}
		if index(*b.ID) < 0 || (b.Before != nil && index(*b.Before) < 0) {
			return 0, fail(404, "Такого трека в плейлисте нет")
		}
		if b.Before != nil && *b.ID == *b.Before {
			return row.Int("rev"), nil
		}
		i := index(*b.ID)
		order = append(order[:i], order[i+1:]...)
		at := len(order)
		if b.Before != nil {
			at = index(*b.Before)
		}
		order = append(order[:at], append([]string{*b.ID}, order[at:]...)...)
		// позиции заново 1..n: плейлист до 2000 треков, дробные зазоры копить незачем
		for i, id := range order {
			if _, err := q.Exec("UPDATE collab_tracks SET pos = ? WHERE code = ? AND track_id = ?", i+1, code, id); err != nil {
				return 0, err
			}
		}
		return bump(q, code)
	})
}

func collabRename(r *http.Request, me Auth) (any, error) {
	var b titleBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	return collabEdit(r, func(q *sql.Tx, row Row) (int64, error) {
		if row.Int("owner_id") != me.UserID {
			return 0, fail(403, "Переименовать может только владелец")
		}
		title, err := cleanTitle(*b.Title)
		if err != nil {
			return 0, err
		}
		if _, err := q.Exec("UPDATE collabs SET title = ? WHERE code = ?", title, row.Str("code")); err != nil {
			return 0, err
		}
		return bump(q, row.Str("code"))
	})
}

func collabLeave(r *http.Request, me Auth) (any, error) {
	err := tx(func(q *sql.Tx) error {
		row, err := findCollab(q, r.PathValue("code"))
		if err != nil {
			return err
		}
		code := row.Str("code")
		if err := mustMember(q, code, me.UserID); err != nil {
			return err
		}
		if _, err := q.Exec("DELETE FROM collab_members WHERE code = ? AND user_id = ?", code, me.UserID); err != nil {
			return err
		}
		heir, err := one(q, "SELECT user_id FROM collab_members WHERE code = ? ORDER BY joined, user_id LIMIT 1", code)
		if err != nil {
			return err
		}
		if heir == nil {
			_, err := q.Exec("DELETE FROM collabs WHERE code = ?", code) // треки и участники — каскадом
			return err
		}
		if row.Int("owner_id") == me.UserID {
			if _, err := q.Exec("UPDATE collabs SET owner_id = ? WHERE code = ?", heir.Int("user_id"), code); err != nil {
				return err
			}
		}
		_, err = bump(q, code)
		return err
	})
	if err != nil {
		return nil, err
	}
	return M{}, nil
}
