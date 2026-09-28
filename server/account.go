// Аккаунты: регистрация, вход, профиль, аватар и синхронизация альбомов, настроек, статистики и ключей.
package main

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
)

const (
	sessionTTL  = 90 * 24 * 3600  // сессия живёт 90 дней с последнего запроса
	maxDoc      = 5 * 1024 * 1024 // один синхронизируемый документ — до 5 МБ
	maxDocs     = 32              // документов у пользователя: альбомы, настройки, ключи и статистика каждого компьютера
	maxDocsSize = 40 * 1024 * 1024
	maxBody     = maxDoc + 1024*1024 // запрос больше этого не читаем вовсе
	maxAvatar   = 256 * 1024         // байт картинки после декодирования
)

var (
	syncKinds = map[string]bool{"albums": true, "settings": true, "stats": true, "keys": true} // keys — зашифрованы на клиенте
	loginRe   = regexp.MustCompile(`^[a-z0-9_.-]{3,32}$`)
	keyRe     = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	avatarRe  = regexp.MustCompile(`^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$`)
)

// admins — логины из AVEON_ADMINS. Без переменной админов нет: логины по умолчанию
// на свежем сервере мог бы первым занять кто угодно
var admins = map[string]bool{}

func isAdmin(login string) bool { return admins[strings.ToLower(login)] }

// ---------- авторизация ----------

type Auth struct{ UserID, SessionID int64 }

func authenticate(header string) (Auth, error) {
	scheme, token, _ := strings.Cut(header, " ")
	if !strings.EqualFold(scheme, "bearer") || token == "" {
		return Auth{}, fail(401, "Нужно войти в аккаунт")
	}
	row, err := one(db, "SELECT id, user_id, last_used FROM sessions WHERE token_hash = ?", tokenHash(token))
	if err != nil {
		return Auth{}, err
	}
	t := now()
	if row == nil || t-row.Int("last_used") > sessionTTL {
		if row != nil {
			db.Exec("DELETE FROM sessions WHERE id = ?", row.Int("id"))
		}
		return Auth{}, fail(401, "Сессия истекла, войди заново")
	}
	if t-row.Int("last_used") > 60 {
		if _, err := db.Exec("UPDATE sessions SET last_used = ? WHERE id = ?", t, row.Int("id")); err != nil {
			return Auth{}, err
		}
	}
	return Auth{UserID: row.Int("user_id"), SessionID: row.Int("id")}, nil
}

func userView(u Row) M {
	return M{"id": u.Int("id"), "login": u.Str("login"), "name": u.Str("name"), "created": u.Int("created"),
		"avatar_at": u.Int("avatar_at"), "admin": isAdmin(u.Str("login"))}
}

func getUser(q querier, id int64) (Row, error) {
	u, err := one(q, "SELECT * FROM users WHERE id = ?", id)
	if err == nil && u == nil {
		err = fail(401, "Аккаунт удалён")
	}
	return u, err
}

func startSession(q querier, userID int64, device string) (string, error) {
	token := newToken()
	_, err := q.Exec("INSERT INTO sessions (user_id, token_hash, device, created, last_used) VALUES (?, ?, ?, ?, ?)",
		userID, tokenHash(token), device, now(), now())
	return token, err
}

func checkNewPassword(pw string) error {
	if len([]rune(pw)) < 8 {
		return fail(400, "Пароль должен быть не короче 8 символов")
	}
	return nil
}

// ---------- модели ----------

type registerBody struct {
	Login    *string `json:"login"`
	Password *string `json:"password"`
	Name     string  `json:"name"`
	Device   string  `json:"device"`
}

func (b *registerBody) check() error {
	if b.Login == nil || b.Password == nil || tooLong(*b.Password, 256) || tooLong(b.Name, 64) || tooLong(b.Device, 64) {
		return errFormat
	}
	return nil
}

type loginBody struct {
	Login    *string `json:"login"`
	Password *string `json:"password"`
	Device   string  `json:"device"`
}

func (b *loginBody) check() error {
	if b.Login == nil || b.Password == nil || tooLong(*b.Password, 256) || tooLong(b.Device, 64) {
		return errFormat
	}
	return nil
}

type nameBody struct {
	Name *string `json:"name"`
}

func (b *nameBody) check() error {
	if b.Name == nil || tooLong(*b.Name, 64) {
		return errFormat
	}
	return nil
}

type passwordBody struct {
	Old *string `json:"old"`
	New *string `json:"new"`
}

func (b *passwordBody) check() error {
	if b.Old == nil || b.New == nil || tooLong(*b.Old, 256) || tooLong(*b.New, 256) {
		return errFormat
	}
	return nil
}

type avatarBody struct {
	Avatar string `json:"avatar"` // пустая строка — убрать
}

func (b *avatarBody) check() error {
	if tooLong(b.Avatar, 400_000) {
		return errFormat
	}
	return nil
}

type confirmBody struct {
	Password *string `json:"password"`
}

func (b *confirmBody) check() error {
	if b.Password == nil || tooLong(*b.Password, 256) {
		return errFormat
	}
	return nil
}

type docBody struct {
	Data    json.RawMessage `json:"data"`
	BaseRev *int64          `json:"base_rev"` // ревизия, от которой клиент делал изменения; null — документа ещё нет
}

func (b *docBody) check() error {
	if b.Data == nil {
		return errFormat
	}
	return nil
}

// ---------- эндпоинты ----------

func health(r *http.Request) (any, error) { return M{"ok": true}, nil }

func register(r *http.Request) (any, error) {
	var b registerBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	login := strings.ToLower(strings.TrimSpace(*b.Login))
	if !loginRe.MatchString(login) {
		return nil, fail(400, "Логин: 3–32 символа, латиница, цифры, точка, дефис или подчёркивание")
	}
	if err := checkNewPassword(*b.Password); err != nil {
		return nil, err
	}
	ipKey := "ip:" + clientIP(r)
	if regLimit.Blocked(ipKey) {
		return nil, fail(429, "Слишком много новых аккаунтов, попробуй через час")
	}
	name := strings.TrimSpace(b.Name)
	if name == "" {
		name = login
	}
	hash := hashPassword(*b.Password) // до транзакции: scrypt долгий, базу он держать не должен
	var token string
	var user Row
	err := tx(func(q *sql.Tx) error {
		if taken, err := exists(q, "SELECT 1 FROM users WHERE login = ?", login); err != nil || taken {
			if err == nil {
				err = fail(409, "Такой логин уже занят")
			}
			return err
		}
		res, err := q.Exec("INSERT INTO users (login, name, pw_hash, created) VALUES (?, ?, ?, ?)", login, name, hash, now())
		if err != nil {
			return err
		}
		id, _ := res.LastInsertId()
		if token, err = startSession(q, id, b.Device); err != nil {
			return err
		}
		user, err = getUser(q, id)
		return err
	})
	if err != nil {
		return nil, err
	}
	regLimit.Hit(ipKey) // считаем удачные регистрации, а не ошибки
	return M{"token": token, "user": userView(user)}, nil
}

func login(r *http.Request) (any, error) {
	var b loginBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	login := strings.ToLower(strings.TrimSpace(*b.Login))
	keys := []string{"ip:" + clientIP(r), "login:" + login}
	for _, k := range keys {
		if loginLimit.Blocked(k) {
			return nil, fail(429, "Слишком много попыток входа, попробуй через 15 минут")
		}
	}
	user, err := one(db, "SELECT * FROM users WHERE login = ?", login)
	if err != nil {
		return nil, err
	}
	stored := dummyHash
	if user != nil {
		stored = user.Str("pw_hash")
	}
	ok := checkPassword(*b.Password, stored)
	if user != nil && ok && user.Int("banned") != 0 {
		return nil, fail(403, "Аккаунт заблокирован")
	}
	if user == nil || !ok {
		for _, k := range keys {
			loginLimit.Hit(k)
		}
		return nil, fail(401, "Неверный логин или пароль")
	}
	loginLimit.Reset("login:" + login)
	token, err := startSession(db, user.Int("id"), b.Device)
	if err != nil {
		return nil, err
	}
	return M{"token": token, "user": userView(user)}, nil
}

func logout(r *http.Request, me Auth) (any, error) {
	_, err := db.Exec("DELETE FROM sessions WHERE id = ?", me.SessionID)
	return M{"ok": true}, err
}

// logoutAll — выйти на всех устройствах, кроме текущего
func logoutAll(r *http.Request, me Auth) (any, error) {
	res, err := db.Exec("DELETE FROM sessions WHERE user_id = ? AND id != ?", me.UserID, me.SessionID)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	return M{"closed": n}, nil
}

func meGet(r *http.Request, me Auth) (any, error) {
	user, err := getUser(db, me.UserID)
	if err != nil {
		return nil, err
	}
	devices, err := all(db, "SELECT id, device, created, last_used FROM sessions WHERE user_id = ? ORDER BY last_used DESC", me.UserID)
	if err != nil {
		return nil, err
	}
	sessions := []M{}
	for _, d := range devices {
		sessions = append(sessions, M{"id": d.Int("id"), "device": d.Str("device"), "created": d.Int("created"),
			"last_used": d.Int("last_used"), "current": d.Int("id") == me.SessionID})
	}
	return M{"user": userView(user), "sessions": sessions}, nil
}

func meUpdate(r *http.Request, me Auth) (any, error) {
	var b nameBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(*b.Name)
	if name == "" {
		return nil, fail(400, "Имя не может быть пустым")
	}
	if _, err := db.Exec("UPDATE users SET name = ? WHERE id = ?", name, me.UserID); err != nil {
		return nil, err
	}
	user, err := getUser(db, me.UserID)
	if err != nil {
		return nil, err
	}
	return M{"user": userView(user)}, nil
}

// meAvatar — аватар профиля: data:image/jpeg|png|webp;base64,… или пустая строка, чтобы убрать
func meAvatar(r *http.Request, me Auth) (any, error) {
	var b avatarBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	data := strings.TrimSpace(b.Avatar)
	if data != "" {
		m := avatarRe.FindStringSubmatch(data)
		if m == nil {
			return nil, fail(400, "Аватар должен быть картинкой JPEG, PNG или WEBP")
		}
		img, err := base64.StdEncoding.DecodeString(m[2])
		if err != nil {
			return nil, fail(400, "Картинка повреждена")
		}
		if len(img) > maxAvatar {
			return nil, fail(413, "Аватар больше 256 КБ")
		}
	}
	if _, err := db.Exec("UPDATE users SET avatar = ?, avatar_at = ? WHERE id = ?", data, now(), me.UserID); err != nil {
		return nil, err
	}
	user, err := getUser(db, me.UserID)
	if err != nil {
		return nil, err
	}
	return M{"user": userView(user)}, nil
}

// avatarGet — аватар любого пользователя, для «Слушать вместе» и друзей. Только для вошедших
func avatarGet(r *http.Request, me Auth) (any, error) {
	id, err := pathInt(r, "id")
	if err != nil {
		return nil, err
	}
	row, err := one(db, "SELECT avatar FROM users WHERE id = ?", id)
	if err != nil {
		return nil, err
	}
	var m []string
	if row != nil {
		m = avatarRe.FindStringSubmatch(row.Str("avatar"))
	}
	if m == nil {
		return nil, fail(404, "Аватара нет")
	}
	img, _ := base64.StdEncoding.DecodeString(m[2])
	return raw(func(w http.ResponseWriter) {
		w.Header().Set("Content-Type", "image/"+m[1])
		w.Header().Set("Cache-Control", "private, max-age=86400")
		w.Write(img)
	}), nil
}

func mePassword(r *http.Request, me Auth) (any, error) {
	var b passwordBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	if err := checkNewPassword(*b.New); err != nil {
		return nil, err
	}
	user, err := getUser(db, me.UserID)
	if err != nil {
		return nil, err
	}
	if !checkPassword(*b.Old, user.Str("pw_hash")) {
		return nil, fail(403, "Старый пароль не подходит")
	}
	hash := hashPassword(*b.New)
	err = tx(func(q *sql.Tx) error {
		if _, err := q.Exec("UPDATE users SET pw_hash = ? WHERE id = ?", hash, me.UserID); err != nil {
			return err
		}
		// сменили пароль — остальные устройства должны войти заново
		_, err := q.Exec("DELETE FROM sessions WHERE user_id = ? AND id != ?", me.UserID, me.SessionID)
		return err
	})
	return M{"ok": true}, err
}

func meDelete(r *http.Request, me Auth) (any, error) {
	var b confirmBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	user, err := getUser(db, me.UserID)
	if err != nil {
		return nil, err
	}
	if !checkPassword(*b.Password, user.Str("pw_hash")) {
		return nil, fail(403, "Пароль не подходит")
	}
	_, err = db.Exec("DELETE FROM users WHERE id = ?", me.UserID) // сессии и документы удалятся каскадом
	return M{"ok": true}, err
}

// ---------- синхронизация ----------

func syncGet(r *http.Request, me Auth) (any, error) {
	rows, err := all(db, "SELECT kind, key, rev, data, updated FROM docs WHERE user_id = ?", me.UserID)
	if err != nil {
		return nil, err
	}
	docs := []M{}
	for _, d := range rows {
		docs = append(docs, M{"kind": d.Str("kind"), "key": d.Str("key"), "rev": d.Int("rev"),
			"data": json.RawMessage(d.Str("data")), "updated": d.Int("updated")})
	}
	return M{"docs": docs}, nil
}

// checkQuota — ключ документа выбирает клиент: без квоты можно завести тысячи документов по 5 МБ
func checkQuota(q querier, userID int64, kind, key string, size int, isNew bool) error {
	row, err := one(q, "SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(CAST(data AS BLOB))), 0) AS total FROM docs "+
		"WHERE user_id = ? AND NOT (kind = ? AND key = ?)", userID, kind, key)
	if err != nil {
		return err
	}
	if isNew && row.Int("n") >= maxDocs {
		return fail(413, "Слишком много документов синхронизации")
	}
	if row.Int("total")+int64(size) > maxDocsSize {
		return fail(413, "Слишком много данных для синхронизации")
	}
	return nil
}

// syncPut записывает документ, если он не менялся с base_rev. Иначе 409 и текущая версия сервера —
// клиент сливает её со своей и присылает снова
func syncPut(r *http.Request, me Auth) (any, error) {
	kind, key := r.PathValue("kind"), r.PathValue("key")
	if !syncKinds[kind] || !keyRe.MatchString(key) {
		return nil, fail(404, "Нет такого документа")
	}
	var b docBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	data, err := compact(b.Data)
	if err != nil {
		return nil, err
	}
	if len(data) > maxDoc {
		return nil, fail(413, "Слишком много данных для синхронизации")
	}
	var rev int64
	err = tx(func(q *sql.Tx) error {
		row, err := one(q, "SELECT rev, data, updated FROM docs WHERE user_id = ? AND kind = ? AND key = ?", me.UserID, kind, key)
		if err != nil {
			return err
		}
		var cur *int64
		if row != nil {
			v := row.Int("rev")
			cur = &v
		}
		same := (cur == nil && b.BaseRev == nil) || (cur != nil && b.BaseRev != nil && *cur == *b.BaseRev)
		if !same {
			conflict := M{"error": "Данные на сервере изменились", "rev": nil, "data": nil, "updated": nil}
			if row != nil {
				conflict["rev"], conflict["data"], conflict["updated"] = *cur, json.RawMessage(row.Str("data")), row.Int("updated")
			}
			return &apiError{409, conflict}
		}
		if err := checkQuota(q, me.UserID, kind, key, len(data), row == nil); err != nil {
			return err
		}
		rev = 1
		if cur != nil {
			rev = *cur + 1
		}
		_, err = q.Exec("INSERT INTO docs (user_id, kind, key, rev, data, updated) VALUES (?, ?, ?, ?, ?, ?) "+
			"ON CONFLICT (user_id, kind, key) DO UPDATE SET rev = excluded.rev, data = excluded.data, updated = excluded.updated",
			me.UserID, kind, key, rev, data, now())
		return err
	})
	if err != nil {
		return nil, err
	}
	return M{"rev": rev}, nil
}
