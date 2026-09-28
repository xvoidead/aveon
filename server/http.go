// HTTP-обвязка: ошибки в одном виде {"error": "текст"} (плеер показывает его как есть),
// разбор тела запроса, авторизация по токену и настоящий IP за nginx.
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type M = map[string]any

type apiError struct {
	status int
	body   any
}

func (e *apiError) Error() string { return http.StatusText(e.status) }

func fail(status int, msg string) error { return &apiError{status, M{"error": msg}} }

var errFormat = fail(422, "Неверный формат запроса")

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	enc.Encode(v)
}

// raw — ответ, который обработчик пишет сам (HTML-страница, картинка)
type raw func(w http.ResponseWriter)

func api(fn func(r *http.Request) (any, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		res, err := fn(r)
		if err != nil {
			var ae *apiError
			if errors.As(err, &ae) {
				writeJSON(w, ae.status, ae.body)
				return
			}
			slog.Error("request failed", "method", r.Method, "path", r.URL.Path, "err", err)
			writeJSON(w, 500, M{"error": "Ошибка сервера, попробуй позже"})
			return
		}
		if write, ok := res.(raw); ok {
			write(w)
			return
		}
		writeJSON(w, 200, res)
	}
}

func authed(fn func(r *http.Request, me Auth) (any, error)) http.HandlerFunc {
	return api(func(r *http.Request) (any, error) {
		me, err := authenticate(r.Header.Get("Authorization"))
		if err != nil {
			return nil, err
		}
		return fn(r, me)
	})
}

// ---------- тело запроса ----------

type checker interface{ check() error }

// decode читает JSON-объект в v и проверяет поля (метод check, если есть)
func decode(r *http.Request, v any) error {
	body, err := io.ReadAll(http.MaxBytesReader(nil, r.Body, maxBody))
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			return fail(413, "Слишком большой запрос")
		}
		return errFormat
	}
	if t := bytes.TrimSpace(body); len(t) == 0 || t[0] != '{' {
		return errFormat
	}
	if err := json.Unmarshal(body, v); err != nil {
		return errFormat
	}
	if c, ok := v.(checker); ok {
		return c.check()
	}
	return nil
}

// tooLong — длина в символах, как max_length у pydantic в старой версии
func tooLong(s string, n int) bool { return utf8.RuneCountInString(s) > n }

func pathInt(r *http.Request, name string) (int64, error) {
	n, err := strconv.ParseInt(r.PathValue(name), 10, 64)
	if err != nil {
		return 0, errFormat
	}
	return n, nil
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

func now() int64   { return time.Now().Unix() }
func nowMs() int64 { return time.Now().UnixMilli() }

// ---------- JSON без схемы (треки, статистика) ----------

type obj = map[string]json.RawMessage

func asObject(v json.RawMessage) (obj, bool) {
	t := bytes.TrimSpace(v)
	if len(t) == 0 || t[0] != '{' {
		return nil, false
	}
	var o obj
	if json.Unmarshal(t, &o) != nil {
		return nil, false
	}
	return o, true
}

func isNull(v json.RawMessage) bool {
	t := bytes.TrimSpace(v)
	return len(t) == 0 || string(t) == "null"
}

// truthy — истинность по правилам Python: null, false, 0, "", [], {} — ложь
func truthy(v json.RawMessage) bool {
	switch t := string(bytes.TrimSpace(v)); t {
	case "", "null", "false", `""`, "[]", "{}":
		return false
	default:
		if f, err := strconv.ParseFloat(t, 64); err == nil {
			return f != 0
		}
		if strings.HasPrefix(t, "[") || strings.HasPrefix(t, "{") {
			var x []any
			if json.Unmarshal(v, &x) == nil {
				return len(x) > 0
			}
			var m map[string]any
			if json.Unmarshal(v, &m) == nil {
				return len(m) > 0
			}
		}
		return true
	}
}

// text — str(v or "") из Python: строка как есть, пустое — "", остальное — JSON-запись
func text(v json.RawMessage) string {
	if !truthy(v) {
		return ""
	}
	var s string
	if json.Unmarshal(v, &s) == nil {
		return s
	}
	t := string(bytes.TrimSpace(v))
	if t == "true" {
		return "True"
	}
	return t
}

// number — float(v or 0): число, числовая строка или true; ok=false — не число
func number(v json.RawMessage) (float64, bool) {
	if !truthy(v) {
		return 0, true
	}
	var f float64
	if json.Unmarshal(v, &f) == nil {
		return f, true
	}
	var s string
	if json.Unmarshal(v, &s) == nil {
		f, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
		return f, err == nil && !math.IsInf(f, 0) && !math.IsNaN(f)
	}
	if string(bytes.TrimSpace(v)) == "true" {
		return 1, true
	}
	return 0, false
}

// compact — JSON без пробелов для хранения
func compact(v json.RawMessage) (string, error) {
	var b bytes.Buffer
	if err := json.Compact(&b, v); err != nil {
		return "", errFormat
	}
	return b.String(), nil
}

// ordered — пары объекта в порядке записи (Python-словарь хранил порядок, от него зависят равные места в топах)
type pair struct {
	key string
	val json.RawMessage
}

func ordered(v json.RawMessage) []pair {
	dec := json.NewDecoder(bytes.NewReader(v))
	if t, err := dec.Token(); err != nil || t != json.Delim('{') {
		return nil
	}
	var out []pair
	for dec.More() {
		t, err := dec.Token()
		if err != nil {
			return out
		}
		var val json.RawMessage
		if err := dec.Decode(&val); err != nil {
			return out
		}
		out = append(out, pair{t.(string), val})
	}
	return out
}

func roundHalfEven(f float64) int64 { return int64(math.RoundToEven(f)) }

// ---------- IP клиента ----------

// trustedProxies — от кого верить X-Forwarded-For (AVEON_PROXIES). "*" — от всех:
// так можно, только если порт закрыт от интернета и достучаться может лишь nginx
var trustedProxies []*net.IPNet
var trustAll bool

func setProxies(list string) {
	for _, s := range strings.Split(list, ",") {
		s = strings.TrimSpace(s)
		switch {
		case s == "":
		case s == "*":
			trustAll = true
		case strings.Contains(s, "/"):
			if _, n, err := net.ParseCIDR(s); err == nil {
				trustedProxies = append(trustedProxies, n)
			}
		default:
			if ip := net.ParseIP(s); ip != nil {
				bits := 128
				if ip.To4() != nil {
					ip, bits = ip.To4(), 32
				}
				trustedProxies = append(trustedProxies, &net.IPNet{IP: ip, Mask: net.CIDRMask(bits, bits)})
			}
		}
	}
}

func trusted(ip string) bool {
	if trustAll {
		return true
	}
	p := net.ParseIP(ip)
	for _, n := range trustedProxies {
		if p != nil && n.Contains(p) {
			return true
		}
	}
	return false
}

// clientIP — адрес соединения, а если оно от доверенного прокси — самый правый недоверенный адрес из X-Forwarded-For
func clientIP(r *http.Request) string {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		ip = r.RemoteAddr
	}
	if !trusted(ip) {
		return ip
	}
	hops := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for i := len(hops) - 1; i >= 0; i-- {
		h := strings.TrimSpace(hops[i])
		if h == "" {
			continue
		}
		if !trusted(h) || i == 0 {
			return h
		}
	}
	return ip
}

// ---------- журнал запросов ----------

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (s *statusWriter) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// Unwrap и Hijack — чтобы WebSocket мог забрать соединение себе
func (s *statusWriter) Unwrap() http.ResponseWriter { return s.ResponseWriter }

func (s *statusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	s.status = 101
	return http.NewResponseController(s.ResponseWriter).Hijack()
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// огромный запрос отклоняем по заголовку, не читая
		if r.ContentLength > maxBody {
			writeJSON(w, 413, M{"error": "Слишком большой запрос"})
			return
		}
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(sw, r)
		slog.Info("http", "method", r.Method, "path", r.URL.Path, "status", sw.status,
			"ms", time.Since(start).Milliseconds(), "ip", clientIP(r))
	})
}
