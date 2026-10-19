// Почта аккаунта и сброс пароля. Почта необязательная: её привязывают в профиле и подтверждают кодом
// из письма. Забытый пароль восстанавливают так же — кодом на подтверждённую почту, прямо в плеере.
package main

import (
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"fmt"
	"log/slog"
	"math/big"
	"net/http"
	"regexp"
	"strings"
)

const (
	codeTTL      = 15 * 60 // код из письма живёт 15 минут
	codeAttempts = 5       // столько раз можно ошибиться, потом код сгорает
)

var emailRe = regexp.MustCompile(`^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$`)

// normEmail — почта в нижнем регистре без пробелов по краям; пустая строка, если адрес не похож на почту
func normEmail(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if len(s) > 254 || !emailRe.MatchString(s) {
		return ""
	}
	return s
}

func newDigits() string {
	n, _ := rand.Int(rand.Reader, big.NewInt(1_000_000))
	return fmt.Sprintf("%06d", n.Int64())
}

// issueCode кладёт новый код (старый того же назначения пропадает) и возвращает его
func issueCode(userID int64, purpose, addr string) (string, error) {
	code := newDigits()
	_, err := db.Exec("INSERT INTO email_codes (user_id, purpose, email, code_hash, expires, attempts) VALUES (?, ?, ?, ?, ?, 0) "+
		"ON CONFLICT (user_id, purpose) DO UPDATE SET email = excluded.email, code_hash = excluded.code_hash, "+
		"expires = excluded.expires, attempts = 0", userID, purpose, addr, tokenHash(purpose+":"+code), now()+codeTTL)
	return code, err
}

var errBadCode = fail(400, "Код не подошёл — проверь цифры или запроси новый")

// useCode проверяет и гасит код. Ошибка засчитывается попыткой; после codeAttempts код удаляется.
// Возвращает почту, на которую код отправляли
func useCode(userID int64, purpose, code string) (string, error) {
	return matchCode(userID, purpose, code, true)
}

// matchCode — то же, но с consume=false верный код остаётся: плеер проверяет его до ввода нового пароля
func matchCode(userID int64, purpose, code string, consume bool) (string, error) {
	row, err := one(db, "SELECT email, code_hash, expires, attempts FROM email_codes WHERE user_id = ? AND purpose = ?", userID, purpose)
	if err != nil {
		return "", err
	}
	if row == nil || row.Int("expires") < now() {
		return "", errBadCode
	}
	want := tokenHash(purpose + ":" + strings.TrimSpace(code))
	if subtle.ConstantTimeCompare([]byte(want), []byte(row.Str("code_hash"))) != 1 {
		if row.Int("attempts")+1 >= codeAttempts {
			_, err = db.Exec("DELETE FROM email_codes WHERE user_id = ? AND purpose = ?", userID, purpose)
		} else {
			_, err = db.Exec("UPDATE email_codes SET attempts = attempts + 1 WHERE user_id = ? AND purpose = ?", userID, purpose)
		}
		if err != nil {
			return "", err
		}
		return "", errBadCode
	}
	if !consume {
		return row.Str("email"), nil
	}
	// удаляет ровно один запрос: второй, пришедший с тем же кодом одновременно, получит 0 строк
	res, err := db.Exec("DELETE FROM email_codes WHERE user_id = ? AND purpose = ? AND code_hash = ?", userID, purpose, want)
	if err != nil {
		return "", err
	}
	if n, _ := res.RowsAffected(); n != 1 {
		return "", errBadCode
	}
	return row.Str("email"), nil
}

// meView — профиль для самого пользователя: ещё и почта, которую он начал привязывать
func meView(u Row) (M, error) {
	v := userView(u)
	v["email_pending"] = ""
	row, err := one(db, "SELECT email, expires FROM email_codes WHERE user_id = ? AND purpose = 'verify'", u.Int("id"))
	if row != nil && row.Int("expires") >= now() {
		v["email_pending"] = row.Str("email")
	}
	return v, err
}

// ---------- модели ----------

type emailBody struct {
	Email *string `json:"email"`
}

func (b *emailBody) check() error {
	if b.Email == nil || tooLong(*b.Email, 300) {
		return errFormat
	}
	return nil
}

type codeBody struct {
	Code *string `json:"code"`
}

func (b *codeBody) check() error {
	if b.Code == nil || tooLong(*b.Code, 16) {
		return errFormat
	}
	return nil
}

type resetRequestBody struct {
	Login *string `json:"login"` // логин или почта
}

func (b *resetRequestBody) check() error {
	if b.Login == nil || tooLong(*b.Login, 300) {
		return errFormat
	}
	return nil
}

type resetCheckBody struct {
	Login *string `json:"login"`
	Code  *string `json:"code"`
}

func (b *resetCheckBody) check() error {
	if b.Login == nil || b.Code == nil || tooLong(*b.Login, 300) || tooLong(*b.Code, 16) {
		return errFormat
	}
	return nil
}

type resetConfirmBody struct {
	Login    *string `json:"login"`
	Code     *string `json:"code"`
	Password *string `json:"password"`
	Device   string  `json:"device"`
}

func (b *resetConfirmBody) check() error {
	if b.Login == nil || b.Code == nil || b.Password == nil || tooLong(*b.Login, 300) || tooLong(*b.Code, 16) ||
		tooLong(*b.Password, 256) || tooLong(b.Device, 64) {
		return errFormat
	}
	return nil
}

// ---------- почта в профиле ----------

// meEmail — привязать почту (придёт код) или убрать её пустой строкой
func meEmail(r *http.Request, me Auth) (any, error) {
	var b emailBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	user, err := getUser(db, me.UserID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(*b.Email) == "" {
		err := tx(func(q *sql.Tx) error {
			if _, err := q.Exec("UPDATE users SET email = '' WHERE id = ?", me.UserID); err != nil {
				return err
			}
			_, err := q.Exec("DELETE FROM email_codes WHERE user_id = ?", me.UserID)
			return err
		})
		if err != nil {
			return nil, err
		}
		user["email"] = ""
		v, err := meView(user)
		return M{"user": v, "sent": false}, err
	}
	addr := normEmail(*b.Email)
	if addr == "" {
		return nil, fail(400, "Это не похоже на адрес почты")
	}
	if addr == user.Str("email") {
		v, err := meView(user)
		return M{"user": v, "sent": false}, err
	}
	if taken, err := exists(db, "SELECT 1 FROM users WHERE email = ? AND id != ?", addr, me.UserID); err != nil || taken {
		if err == nil {
			err = fail(409, "Эта почта уже привязана к другому аккаунту")
		}
		return nil, err
	}
	if !mailEnabled() {
		return nil, fail(503, "Почта на сервере не настроена")
	}
	if err := mailBudget(r, "verify:"+itoa(me.UserID)); err != nil {
		return nil, err
	}
	code, err := issueCode(me.UserID, "verify", addr)
	if err != nil {
		return nil, err
	}
	text, html := codeMail("подтверди почту", "Введи код в профиле плеера — и эта почта привяжется к аккаунту «"+user.Str("login")+"».",
		code, "Если это не ты, просто удали письмо — почта не привяжется.")
	if err := sendMail(addr, code+" — код подтверждения почты", text, html); err != nil {
		db.Exec("DELETE FROM email_codes WHERE user_id = ? AND purpose = 'verify'", me.UserID)
		slog.Error("письмо не ушло", "to", addr, "err", err)
		return nil, fail(502, "Не удалось отправить письмо, попробуй позже")
	}
	v, err := meView(user)
	return M{"user": v, "sent": true}, err
}

func meEmailConfirm(r *http.Request, me Auth) (any, error) {
	var b codeBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	addr, err := useCode(me.UserID, "verify", *b.Code)
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec("UPDATE users SET email = ? WHERE id = ?", addr, me.UserID); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") { // кто-то успел привязать её раньше
			return nil, fail(409, "Эта почта уже привязана к другому аккаунту")
		}
		return nil, err
	}
	user, err := getUser(db, me.UserID)
	if err != nil {
		return nil, err
	}
	v, err := meView(user)
	return M{"user": v}, err
}

// ---------- сброс пароля ----------

// findUser — по логину или по почте (если есть @)
func findUser(who string) (Row, error) {
	who = strings.ToLower(strings.TrimSpace(who))
	if strings.Contains(who, "@") {
		if who = normEmail(who); who == "" {
			return nil, nil
		}
		return one(db, "SELECT * FROM users WHERE email = ?", who)
	}
	return one(db, "SELECT * FROM users WHERE login = ?", who)
}

// resetRequest всегда отвечает одинаково и сразу, а письмо шлёт в фоне: ни ответ, ни время ответа
// не выдают, есть ли такой аккаунт и привязана ли к нему почта
func resetRequest(r *http.Request) (any, error) {
	var b resetRequestBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	ipKey := "ip:" + clientIP(r)
	if mailIPLimit.Blocked(ipKey) {
		return nil, fail(429, "Слишком много запросов, попробуй через час")
	}
	mailIPLimit.Hit(ipKey)
	if !mailEnabled() {
		return nil, fail(503, "Почта на сервере не настроена")
	}
	user, err := findUser(*b.Login)
	if err != nil {
		return nil, err
	}
	key := ""
	if user != nil {
		key = "reset:" + itoa(user.Int("id"))
	}
	if user == nil || user.Str("email") == "" || user.Int("banned") != 0 || mailUserLimit.Blocked(key) {
		return M{"ok": true}, nil
	}
	mailUserLimit.Hit(key)
	code, err := issueCode(user.Int("id"), "reset", user.Str("email"))
	if err != nil {
		return nil, err
	}
	addr, login := user.Str("email"), user.Str("login")
	go func() {
		text, html := codeMail("сброс пароля", "Введи код в плеере — и придумаешь новый пароль для аккаунта «"+login+"».",
			code, "Если сброс просил не ты, просто удали письмо — пароль останется прежним.")
		if err := sendMail(addr, code+" — код для сброса пароля", text, html); err != nil {
			slog.Error("письмо со сбросом не ушло", "user", login, "err", err)
		}
	}()
	return M{"ok": true}, nil
}

// resetCheck — верен ли код, не меняя пароля. Неверный код тратит попытку, как и в resetConfirm
func resetCheck(r *http.Request) (any, error) {
	var b resetCheckBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	ipKey := "ip:" + clientIP(r)
	if codeLimit.Blocked(ipKey) {
		return nil, fail(429, "Слишком много неверных кодов, попробуй через 10 минут")
	}
	user, err := findUser(*b.Login)
	if err != nil {
		return nil, err
	}
	if user == nil {
		codeLimit.Hit(ipKey)
		return nil, errBadCode
	}
	if _, err := matchCode(user.Int("id"), "reset", *b.Code, false); err != nil {
		codeLimit.Hit(ipKey)
		return nil, err
	}
	return M{"ok": true}, nil
}

func resetConfirm(r *http.Request) (any, error) {
	var b resetConfirmBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	if err := checkNewPassword(*b.Password); err != nil {
		return nil, err // до проверки кода: короткий пароль не должен сжигать попытку
	}
	ipKey := "ip:" + clientIP(r)
	if codeLimit.Blocked(ipKey) {
		return nil, fail(429, "Слишком много неверных кодов, попробуй через 10 минут")
	}
	user, err := findUser(*b.Login)
	if err != nil {
		return nil, err
	}
	if user == nil {
		codeLimit.Hit(ipKey)
		return nil, errBadCode
	}
	if user.Int("banned") != 0 {
		return nil, fail(403, "Аккаунт заблокирован")
	}
	id := user.Int("id")
	if _, err := useCode(id, "reset", *b.Code); err != nil {
		codeLimit.Hit(ipKey)
		return nil, err
	}
	hash := hashPassword(*b.Password) // до транзакции: scrypt долгий, базу он держать не должен
	var token string
	err = tx(func(q *sql.Tx) error {
		if _, err := q.Exec("UPDATE users SET pw_hash = ? WHERE id = ?", hash, id); err != nil {
			return err
		}
		// пароль сменили — все старые устройства должны войти заново
		if _, err := q.Exec("DELETE FROM sessions WHERE user_id = ?", id); err != nil {
			return err
		}
		token, err = startSession(q, id, b.Device)
		return err
	})
	if err != nil {
		return nil, err
	}
	loginLimit.Reset("login:" + strings.ToLower(user.Str("login")))
	slog.Info("сброс пароля по почте", "user", id, "login", user.Str("login"))
	return M{"token": token, "user": userView(user)}, nil
}

// mailBudget — не больше трёх писем на одно действие пользователя в час и двадцати с одного IP
func mailBudget(r *http.Request, key string) error {
	ipKey := "ip:" + clientIP(r)
	if mailUserLimit.Blocked(key) || mailIPLimit.Blocked(ipKey) {
		return fail(429, "Слишком много писем, попробуй через час")
	}
	mailUserLimit.Hit(key)
	mailIPLimit.Hit(ipKey)
	return nil
}
