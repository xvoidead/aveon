// Пароли (scrypt, тот же формат, что писала версия на Python), токены сессий и лимиты попыток.
package main

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/scrypt"
)

// Параметры scrypt: ~16 МБ памяти и десятки миллисекунд на хеш — перебор дорогой, вход быстрый
const scryptN, scryptR, scryptP = 1 << 14, 8, 1

func hashPassword(password string) string {
	salt := make([]byte, 16)
	rand.Read(salt)
	dk, _ := scrypt.Key([]byte(password), salt, scryptN, scryptR, scryptP, 32)
	b64 := base64.StdEncoding.EncodeToString
	return fmt.Sprintf("scrypt$%d$%d$%d$%s$%s", scryptN, scryptR, scryptP, b64(salt), b64(dk))
}

func checkPassword(password, stored string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 6 || parts[0] != "scrypt" {
		return false
	}
	n, err1 := strconv.Atoi(parts[1])
	r, err2 := strconv.Atoi(parts[2])
	p, err3 := strconv.Atoi(parts[3])
	salt, err4 := base64.StdEncoding.DecodeString(parts[4])
	want, err5 := base64.StdEncoding.DecodeString(parts[5])
	if err1 != nil || err2 != nil || err3 != nil || err4 != nil || err5 != nil || len(want) == 0 {
		return false
	}
	got, err := scrypt.Key([]byte(password), salt, n, r, p, len(want))
	return err == nil && subtle.ConstantTimeCompare(got, want) == 1
}

// Хеш, который проверяем, когда логина нет: ответ по времени не выдаёт, существует ли аккаунт
var dummyHash = hashPassword(newToken())

func newToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// В базе лежит только sha256 токена: утечка базы не даёт войти
func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// codeAlphabet — без 0/O и 1/I, чтобы код легко продиктовать. Ровно 32 символа: байт % 32 равномерен
const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func randomCode(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	for i := range b {
		b[i] = codeAlphabet[b[i]%32]
	}
	return string(b)
}

func randomHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// RateLimit — не больше limit событий на ключ за window
type RateLimit struct {
	limit  int
	window time.Duration
	mu     sync.Mutex
	hits   map[string][]time.Time
}

func newRateLimit(limit int, window time.Duration) *RateLimit {
	return &RateLimit{limit: limit, window: window, hits: map[string][]time.Time{}}
}

func (l *RateLimit) fresh(key string, now time.Time) []time.Time {
	var keep []time.Time
	for _, t := range l.hits[key] {
		if now.Sub(t) < l.window {
			keep = append(keep, t)
		}
	}
	if len(keep) > 0 {
		l.hits[key] = keep
	} else {
		delete(l.hits, key)
	}
	return keep
}

func (l *RateLimit) Blocked(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.fresh(key, time.Now())) >= l.limit
}

func (l *RateLimit) Hit(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	l.hits[key] = append(l.fresh(key, now), now)
}

func (l *RateLimit) Reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.hits, key)
}

// Prune выкидывает ключи без свежих попыток — иначе карта растёт от каждого нового логина и IP
func (l *RateLimit) Prune() {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	for key := range l.hits {
		l.fresh(key, now)
	}
}

var (
	loginLimit = newRateLimit(10, 15*time.Minute) // неудачные входы на IP и на логин
	regLimit   = newRateLimit(10, time.Hour)      // новые аккаунты с одного IP
	joinLimit  = newRateLimit(20, 10*time.Minute) // неверные коды рум: код из 6 символов можно перебрать
)
