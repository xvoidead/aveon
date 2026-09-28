// Совместное прослушивание: румы (комнаты) на WebSocket.
//
// Один создаёт руму и получает код, друзья входят по коду. Сервер хранит последнее
// состояние (трек, играет/пауза, позиция и серверное время этой позиции) и пересылает
// его остальным. Звук сервер не передаёт — каждый плеер играет трек сам.
//
// Протокол — JSON-сообщения с полем "t":
//
//	клиент → сервер
//	  hello  {token}                   первым сообщением, иначе соединение закрывается
//	  create {}                        создать руму
//	  join   {code}                    войти в руму
//	  state  {state, beat?}            новое состояние; отправитель становится ведущим
//	  ping   {c}                       сверка часов: c — время клиента
//	  react  {e}                       реакция: одна из reacts, не чаще раза в 300 мс
//	  skip   {dir}                     «следующий» / «предыдущий» у гостя: dir — next | prev.
//	                                   Очередь (волна, плейлист) есть только у того, кто её включил, —
//	                                   он и переключает, остальные просьбу пропускают
//	  leave  {}
//	сервер → клиент
//	  hello   {you, now}
//	  room    {code, you, members, driver, state, now}   members: [{id, name, user, avatar}]
//	  state   {state, driver, by, beat, now}
//	  members {members, driver, joined?, left?}
//	  pong    {c, s}
//	  react   {e, by, from, now}       всем в руме, включая отправителя; состояние румы не меняется
//	  skip    {dir, by, from}          всем, кроме отправителя
//	  error   {error}
//
// Румы живут в памяти процесса: сервер должен работать одним процессом, после перезапуска румы пропадают.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const (
	roomCodeLen = 6
	maxMembers  = 10
	reactGap    = 300 * time.Millisecond // между реакциями одного участника
	skipGap     = 400 * time.Millisecond // между просьбами переключить трек
	maxMessage  = 64 * 1024
	outQueue    = 64 // сообщений в очереди к участнику; не успевает забирать — отключаем
	pingEvery   = 20 * time.Second
)

var reacts = map[string]bool{"🔥": true, "😍": true, "😂": true, "🎉": true, "👏": true, "💀": true, "🥁": true, "🛢": true}

type member struct {
	id        string
	userID    int64
	name      string
	avatarAt  int64 // 0 — аватара нет; сам аватар плеер берёт из /api/avatar/{user}
	conn      *websocket.Conn
	out       chan []byte
	done      chan struct{}
	lastReact time.Time
	lastSkip  time.Time
}

type room struct {
	code    string
	members []*member       // по порядку входа
	state   json.RawMessage // nil — ещё ничего не играло
	driver  string          // кто последним менял трек — он и переключает дальше
}

var (
	roomsMu sync.Mutex
	rooms   = map[string]*room{}
)

// send ставит сообщение в очередь участника. Не успевает забирать — рвём соединение, чтобы не копить память
func (m *member) send(msg M) {
	b, err := json.Marshal(msg)
	if err != nil {
		return
	}
	select {
	case <-m.done:
	case m.out <- b:
	default:
		go m.conn.Close(websocket.StatusTryAgainLater, "не успеваешь получать сообщения")
	}
}

func (m *member) writer() {
	for {
		select {
		case <-m.done:
			return
		case b := <-m.out:
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			err := m.conn.Write(ctx, websocket.MessageText, b)
			cancel()
			if err != nil {
				m.conn.CloseNow()
				return
			}
		}
	}
}

// pinger — живо ли соединение: мёртвое закрываем, и участник уходит из румы
func (m *member) pinger() {
	t := time.NewTicker(pingEvery)
	defer t.Stop()
	for {
		select {
		case <-m.done:
			return
		case <-t.C:
			ctx, cancel := context.WithTimeout(context.Background(), pingEvery)
			err := m.conn.Ping(ctx)
			cancel()
			if err != nil {
				m.conn.CloseNow()
				return
			}
		}
	}
}

// ниже — функции с суффиксом Locked: вызывать под roomsMu

func (r *room) view() []M {
	out := []M{}
	for _, m := range r.members {
		out = append(out, M{"id": m.id, "name": m.name, "user": m.userID, "avatar": m.avatarAt})
	}
	return out
}

func (r *room) driverOrNil() any {
	if r.driver == "" {
		return nil
	}
	return r.driver
}

func (r *room) broadcastLocked(msg M, skip string) {
	for _, m := range r.members {
		if m.id != skip {
			m.send(msg)
		}
	}
}

func newRoomCodeLocked() string {
	for {
		if code := randomCode(roomCodeLen); rooms[code] == nil {
			return code
		}
	}
}

func roomMsg(r *room, m *member) M {
	var state any
	if r.state != nil {
		state = r.state
	}
	return M{"t": "room", "code": r.code, "you": m.id, "members": r.view(), "driver": r.driverOrNil(),
		"state": state, "now": nowMs()}
}

func leaveLocked(r *room, m *member) {
	if r == nil {
		return
	}
	i := -1
	for j, x := range r.members {
		if x == m {
			i = j
		}
	}
	if i < 0 {
		return
	}
	r.members = append(r.members[:i], r.members[i+1:]...)
	if len(r.members) == 0 {
		delete(rooms, r.code)
		return
	}
	if r.driver == m.id {
		r.driver = ""
	}
	r.broadcastLocked(M{"t": "members", "members": r.view(), "driver": r.driverOrNil(), "left": m.name}, "")
}

// ---------- для друзей и админки ----------

func roomExists(code string) bool {
	roomsMu.Lock()
	defer roomsMu.Unlock()
	return rooms[code] != nil
}

// usersInRooms — кто сейчас в какой-нибудь руме
func usersInRooms() map[int64]bool {
	roomsMu.Lock()
	defer roomsMu.Unlock()
	out := map[int64]bool{}
	for _, r := range rooms {
		for _, m := range r.members {
			out[m.userID] = true
		}
	}
	return out
}

type roomInfo struct {
	code    string
	members []*member
	state   json.RawMessage
}

func roomsSnapshot() []roomInfo {
	roomsMu.Lock()
	defer roomsMu.Unlock()
	var out []roomInfo
	for _, r := range rooms {
		out = append(out, roomInfo{r.code, append([]*member(nil), r.members...), r.state})
	}
	return out
}

// ---------- соединение ----------

func who(token string) (userID int64, name string, avatarAt int64, err error) {
	me, err := authenticate("Bearer " + token)
	if err != nil {
		return
	}
	u, err := getUser(db, me.UserID)
	if err != nil {
		return
	}
	return me.UserID, u.Str("name"), u.Int("avatar_at"), nil
}

func together(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true}) // плеер ходит не из браузера
	if err != nil {
		return
	}
	conn.SetReadLimit(1 << 20) // больше maxMessage читаем, чтобы ответить ошибкой, а не рвать соединение
	defer conn.CloseNow()

	userID, name, avatarAt, ok := helloFrom(conn)
	if !ok {
		b, _ := json.Marshal(M{"t": "error", "error": "Нужно войти в аккаунт", "fatal": true})
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		conn.Write(ctx, websocket.MessageText, b)
		cancel()
		conn.Close(4401, "")
		return
	}

	me := &member{id: randomHex(4), userID: userID, name: name, avatarAt: avatarAt, conn: conn,
		out: make(chan []byte, outQueue), done: make(chan struct{})}
	defer close(me.done)
	go me.writer()
	go me.pinger()
	me.send(M{"t": "hello", "you": me.id, "now": nowMs()})

	var cur *room
	defer func() {
		roomsMu.Lock()
		leaveLocked(cur, me)
		roomsMu.Unlock()
	}()

	for {
		_, data, err := conn.Read(context.Background())
		if err != nil {
			var ce websocket.CloseError
			if !errors.As(err, &ce) && !errors.Is(err, context.Canceled) && !strings.Contains(err.Error(), "EOF") {
				slog.Debug("together: соединение оборвалось", "member", me.id, "err", err)
			}
			return
		}
		if len(data) > maxMessage {
			me.send(M{"t": "error", "error": "Слишком большое сообщение"})
			continue
		}
		msg, ok := asObject(data)
		if !ok {
			continue
		}
		var kind string
		json.Unmarshal(msg["t"], &kind)
		if kind == "leave" {
			roomsMu.Lock()
			leaveLocked(cur, me)
			cur = nil
			roomsMu.Unlock()
			conn.Close(websocket.StatusNormalClosure, "")
			return
		}
		roomsMu.Lock()
		cur = handleMessage(cur, me, kind, msg)
		roomsMu.Unlock()
	}
}

// helloFrom ждёт первое сообщение {t: "hello", token} не дольше 10 с
func helloFrom(conn *websocket.Conn) (userID int64, name string, avatarAt int64, ok bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, data, err := conn.Read(ctx)
	if err != nil {
		return
	}
	msg, isObj := asObject(data)
	if !isObj {
		return
	}
	var kind string
	json.Unmarshal(msg["t"], &kind)
	if kind != "hello" {
		return
	}
	userID, name, avatarAt, err = who(text(msg["token"]))
	return userID, name, avatarAt, err == nil
}

// handleMessage — одно сообщение участника; вызывается под roomsMu, возвращает руму, где он теперь
func handleMessage(cur *room, me *member, kind string, msg obj) *room {
	switch kind {
	case "ping":
		c := msg["c"]
		if c == nil {
			c = json.RawMessage("null")
		}
		me.send(M{"t": "pong", "c": c, "s": nowMs()})

	case "create", "join":
		leaveLocked(cur, me)
		var r *room
		if kind == "create" {
			r = &room{code: newRoomCodeLocked()}
			rooms[r.code] = r
		} else {
			key := "user:" + strconv.FormatInt(me.userID, 10)
			if joinLimit.Blocked(key) {
				me.send(M{"t": "error", "error": "Слишком много неверных кодов, попробуй через 10 минут"})
				return nil
			}
			code := strings.ToUpper(strings.TrimSpace(textOrEmpty(msg["code"])))
			if r = rooms[code]; r == nil {
				joinLimit.Hit(key)
				me.send(M{"t": "error", "error": "Рума не найдена. Проверь код"})
				return nil
			}
			if len(r.members) >= maxMembers {
				me.send(M{"t": "error", "error": "В руме уже 10 человек"})
				return nil
			}
		}
		r.members = append(r.members, me)
		me.send(roomMsg(r, me))
		r.broadcastLocked(M{"t": "members", "members": r.view(), "driver": r.driverOrNil(), "joined": me.name}, me.id)
		return r

	case "state":
		if cur == nil {
			return cur
		}
		st, ok := asObject(msg["state"])
		if !ok {
			return cur
		}
		if _, ok := asObject(st["track"]); !ok {
			return cur
		}
		pos, ok := number(st["pos"])
		if !ok || math.IsNaN(pos) || math.IsInf(pos, 0) {
			return cur
		}
		state, _ := json.Marshal(M{"track": st["track"], "playing": truthy(st["playing"]), "pos": math.Max(0, pos), "at": nowMs()})
		cur.state = state
		cur.driver = me.id
		cur.broadcastLocked(M{"t": "state", "state": json.RawMessage(state), "driver": me.id, "by": me.name,
			"beat": truthy(msg["beat"]), "now": nowMs()}, me.id)

	case "react":
		var e string
		json.Unmarshal(msg["e"], &e)
		if cur != nil && reacts[e] && time.Since(me.lastReact) >= reactGap {
			me.lastReact = time.Now()
			cur.broadcastLocked(M{"t": "react", "e": e, "by": me.name, "from": me.id, "now": nowMs()}, "")
		}

	case "skip":
		var d string
		json.Unmarshal(msg["dir"], &d)
		if cur != nil && (d == "next" || d == "prev") && time.Since(me.lastSkip) >= skipGap {
			me.lastSkip = time.Now()
			cur.broadcastLocked(M{"t": "skip", "dir": d, "by": me.name, "from": me.id}, me.id)
		}
	}
	return cur
}

// textOrEmpty — str(msg.get("code", "")): строка как есть, число — его запись
func textOrEmpty(v json.RawMessage) string {
	if isNull(v) {
		return ""
	}
	var s string
	if json.Unmarshal(v, &s) == nil {
		return s
	}
	return string(v)
}
