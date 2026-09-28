// Сообщения между друзьями: текст, треки и альбомы.
//
// Трек в сообщении — тот же снимок, что уходит в «Слушать вместе»: без путей к файлам. Друг включает
// его у себя через свой сервис или найденный аналог. Писать можно только друзьям.
//
//	GET   /api/messages/{id}?before=<msg id>        → {messages}   последние 50 (или до before), входящие отмечаются прочитанными
//	POST  /api/messages/{id}  {text?, track?, album?} → {message}
//	PATCH /api/messages/{id}/{msg}  {text}          → {message}   изменить своё сообщение
//	POST  /api/messages/{id}/{msg}/react  {e}       → {message}   своя реакция: та же ещё раз или null — снять
//
// Альбом в сообщении — {code, title, count, cover}: код из «поделиться» (share.go), друг открывает по нему копию.
// Реакции в сообщении — [{e, users: [id…]}]. Сколько непрочитанного от каждого друга — в GET /api/friends.
package main

import (
	"database/sql"
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"strings"
)

const (
	messagesPage = 50
	maxText      = 2000
	maxAlbum     = 2 * 1024
)

var messageReactions = map[string]bool{"❤️": true, "🔥": true, "😂": true, "😍": true, "👍": true, "👏": true, "😢": true, "💀": true}

type reaction struct {
	E     string  `json:"e"`
	Users []int64 `json:"users"`
}

// reactionsFor — реакции по сообщениям; эмодзи в порядке первой реакции, люди — по времени
func reactionsFor(q querier, ids []int64) (map[int64][]*reaction, error) {
	out := map[int64][]*reaction{}
	if len(ids) == 0 {
		return out, nil
	}
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	rows, err := all(q, "SELECT msg_id, user_id, e FROM message_reactions WHERE msg_id IN ("+placeholders(len(ids))+") ORDER BY at, rowid", args...)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		m, e := r.Int("msg_id"), r.Str("e")
		var found *reaction
		for _, x := range out[m] {
			if x.E == e {
				found = x
			}
		}
		if found == nil {
			found = &reaction{E: e}
			out[m] = append(out[m], found)
		}
		found.Users = append(found.Users, r.Int("user_id"))
	}
	return out, nil
}

func rawOrNil(r Row, k string) any {
	if r.Null(k) {
		return nil
	}
	return json.RawMessage(r.Str(k))
}

func messageView(r Row, me int64, reacts map[int64][]*reaction) M {
	list := reacts[r.Int("id")]
	if list == nil {
		list = []*reaction{}
	}
	var my any
	for _, x := range list {
		for _, u := range x.Users {
			if u == me && my == nil {
				my = x.E
			}
		}
	}
	return M{"id": r.Int("id"), "mine": r.Int("from_id") == me, "text": r.Str("text"),
		"track": rawOrNil(r, "track"), "album": rawOrNil(r, "album"),
		"created": r.Int("created"), "read": r.Int("read") != 0, "edited": r.Int("edited"),
		"reactions": list, "my": my}
}

// ownPair — сообщение из переписки со мной и этим другом, иначе 404
func ownPair(q querier, me, userID, msgID int64) (Row, error) {
	row, err := one(q, "SELECT * FROM messages WHERE id = ? AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))",
		msgID, me, userID, userID, me)
	if err == nil && row == nil {
		err = fail(404, "Такого сообщения нет")
	}
	return row, err
}

type unread struct {
	n    int64
	last M
}

// unreadByFriend — от кого → сколько непрочитанных и последнее из них
func unreadByFriend(q querier, userID int64) (map[int64]unread, error) {
	rows, err := all(q, "SELECT m.from_id, m.id, m.text, m.track, m.album, c.n FROM messages m JOIN "+
		"(SELECT from_id, COUNT(*) AS n, MAX(id) AS last FROM messages WHERE to_id = ? AND read = 0 GROUP BY from_id) c "+
		"ON m.id = c.last", userID)
	if err != nil {
		return nil, err
	}
	out := map[int64]unread{}
	for _, r := range rows {
		out[r.Int("from_id")] = unread{r.Int("n"), M{"id": r.Int("id"), "text": r.Str("text"),
			"track_title": fieldOf(r, "track", "title"), "album_title": fieldOf(r, "album", "title")}}
	}
	return out, nil
}

// fieldOf — строковое поле из JSON в колонке (название трека или альбома)
func fieldOf(r Row, col, field string) string {
	o, _ := asObject(json.RawMessage(r.Str(col)))
	var s string
	json.Unmarshal(o[field], &s)
	return s
}

// reactionsToMe — друг → его последняя реакция на моё сообщение: для уведомления «Дима ❤️»
func reactionsToMe(q querier, userID int64) (map[int64]M, error) {
	rows, err := all(q, "SELECT r.user_id, r.msg_id, r.e, r.at, m.text, m.track FROM message_reactions r "+
		"JOIN messages m ON m.id = r.msg_id WHERE m.from_id = ? AND r.user_id != ? ORDER BY r.at, r.rowid", userID, userID)
	if err != nil {
		return nil, err
	}
	out := map[int64]M{}
	for _, r := range rows { // по порядку — у каждого друга останется последняя
		what := r.Str("text")
		if what == "" {
			what = fieldOf(r, "track", "title")
		}
		if rs := []rune(what); len(rs) > 80 {
			what = string(rs[:80])
		}
		out[r.Int("user_id")] = M{"msg": r.Int("msg_id"), "e": r.Str("e"), "at": r.Int("at"), "text": what}
	}
	return out, nil
}

func mustFriends(q querier, a, b int64, msg string) error {
	ok, err := areFriends(q, a, b)
	if err == nil && !ok {
		err = fail(403, msg)
	}
	return err
}

func messagesGet(r *http.Request, me Auth) (any, error) {
	id, err := pathInt(r, "id")
	if err != nil {
		return nil, err
	}
	before := int64(1) << 62
	if s := r.URL.Query().Get("before"); s != "" {
		if before, err = strconv.ParseInt(s, 10, 64); err != nil {
			return nil, errFormat
		}
	}
	if err := mustFriends(db, me.UserID, id, "Переписываться можно только с друзьями"); err != nil {
		return nil, err
	}
	rows, err := all(db, "SELECT * FROM messages WHERE ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)) "+
		"AND id < ? ORDER BY id DESC LIMIT ?", me.UserID, id, id, me.UserID, before, messagesPage)
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec("UPDATE messages SET read = 1 WHERE from_id = ? AND to_id = ? AND read = 0", id, me.UserID); err != nil {
		return nil, err
	}
	ids := make([]int64, len(rows))
	for i, r := range rows {
		ids[i] = r.Int("id")
	}
	reacts, err := reactionsFor(db, ids)
	if err != nil {
		return nil, err
	}
	out := []M{}
	for i := len(rows) - 1; i >= 0; i-- {
		out = append(out, messageView(rows[i], me.UserID, reacts))
	}
	return M{"messages": out}, nil
}

type messageBody struct {
	Text  string          `json:"text"`
	Track json.RawMessage `json:"track"`
	Album json.RawMessage `json:"album"`
}

func (b *messageBody) check() error {
	if tooLong(b.Text, maxText) {
		return errFormat
	}
	for _, v := range []json.RawMessage{b.Track, b.Album} {
		if _, ok := asObject(v); !isNull(v) && !ok {
			return errFormat
		}
	}
	return nil
}

func messagesSend(r *http.Request, me Auth) (any, error) {
	id, err := pathInt(r, "id")
	if err != nil {
		return nil, err
	}
	var b messageBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	txt := strings.TrimSpace(b.Text)
	var track, album any
	if !isNull(b.Track) {
		t, _ := asObject(b.Track)
		s, err := compact(b.Track)
		if err != nil {
			return nil, err
		}
		if len(s) > maxTrack || strings.TrimSpace(text(t["title"])) == "" {
			return nil, fail(400, "Неверный трек")
		}
		track = s
	}
	if !isNull(b.Album) {
		a, _ := asObject(b.Album)
		code := normCode(text(a["code"]))
		title := text(a["title"])
		if !shareCodeRe.MatchString(code) || strings.TrimSpace(title) == "" {
			return nil, fail(400, "Неверный альбом")
		}
		n, ok := number(a["count"])
		if !ok || math.IsNaN(n) || math.IsInf(n, 0) {
			return nil, fail(400, "Неверный альбом")
		}
		s, _ := json.Marshal(M{"code": code, "title": cut(title, 120), "count": int64(n), "cover": cut(text(a["cover"]), 500)})
		if len(s) > maxAlbum {
			return nil, fail(413, "Неверный альбом")
		}
		album = string(s)
	}
	if txt == "" && track == nil && album == nil {
		return nil, fail(400, "Пустое сообщение")
	}
	var row Row
	err = tx(func(q *sql.Tx) error {
		if err := mustFriends(q, me.UserID, id, "Писать можно только друзьям"); err != nil {
			return err
		}
		res, err := q.Exec("INSERT INTO messages (from_id, to_id, text, track, album, created, read) VALUES (?, ?, ?, ?, ?, ?, 0)",
			me.UserID, id, txt, track, album, now())
		if err != nil {
			return err
		}
		mid, _ := res.LastInsertId()
		row, err = one(q, "SELECT * FROM messages WHERE id = ?", mid)
		return err
	})
	if err != nil {
		return nil, err
	}
	return M{"message": messageView(row, me.UserID, nil)}, nil
}

// cut — первые n символов
func cut(s string, n int) string {
	if rs := []rune(s); len(rs) > n {
		return string(rs[:n])
	}
	return s
}

type editBody struct {
	Text *string `json:"text"`
}

func (b *editBody) check() error {
	if b.Text == nil || tooLong(*b.Text, maxText) {
		return errFormat
	}
	return nil
}

func messageIDs(r *http.Request) (int64, int64, error) {
	id, err := pathInt(r, "id")
	if err != nil {
		return 0, 0, err
	}
	msg, err := pathInt(r, "msg")
	return id, msg, err
}

func messagesEdit(r *http.Request, me Auth) (any, error) {
	id, msgID, err := messageIDs(r)
	if err != nil {
		return nil, err
	}
	var b editBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	txt := strings.TrimSpace(*b.Text)
	var out M
	err = tx(func(q *sql.Tx) error {
		row, err := ownPair(q, me.UserID, id, msgID)
		if err != nil {
			return err
		}
		if row.Int("from_id") != me.UserID {
			return fail(403, "Изменить можно только своё сообщение")
		}
		if txt == "" && row.Null("track") && row.Null("album") {
			return fail(400, "Пустое сообщение")
		}
		if _, err := q.Exec("UPDATE messages SET text = ?, edited = ? WHERE id = ?", txt, now(), msgID); err != nil {
			return err
		}
		out, err = freshMessage(q, msgID, me.UserID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return M{"message": out}, nil
}

func freshMessage(q querier, msgID, me int64) (M, error) {
	row, err := one(q, "SELECT * FROM messages WHERE id = ?", msgID)
	if err != nil {
		return nil, err
	}
	reacts, err := reactionsFor(q, []int64{msgID})
	if err != nil {
		return nil, err
	}
	return messageView(row, me, reacts), nil
}

type reactBody struct {
	E *string `json:"e"`
}

func messagesReact(r *http.Request, me Auth) (any, error) {
	id, msgID, err := messageIDs(r)
	if err != nil {
		return nil, err
	}
	var b reactBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	if b.E != nil && !messageReactions[*b.E] {
		return nil, fail(400, "Такой реакции нет")
	}
	var out M
	err = tx(func(q *sql.Tx) error {
		if _, err := ownPair(q, me.UserID, id, msgID); err != nil {
			return err
		}
		was, err := one(q, "SELECT e FROM message_reactions WHERE msg_id = ? AND user_id = ?", msgID, me.UserID)
		if err != nil {
			return err
		}
		if _, err := q.Exec("DELETE FROM message_reactions WHERE msg_id = ? AND user_id = ?", msgID, me.UserID); err != nil {
			return err
		}
		if b.E != nil && (was == nil || was.Str("e") != *b.E) { // та же ещё раз — снять
			if _, err := q.Exec("INSERT INTO message_reactions (msg_id, user_id, e, at) VALUES (?, ?, ?, ?)", msgID, me.UserID, *b.E, now()); err != nil {
				return err
			}
		}
		out, err = freshMessage(q, msgID, me.UserID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return M{"message": out}, nil
}
