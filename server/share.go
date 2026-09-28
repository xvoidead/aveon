// Поделиться альбомом, пресетом эквалайзера или треком: короткий код вместо простыни текста.
//
// Плеер кладёт снимок (название, треки или полосы) и получает код вида AB3D-7KQM. Друг вводит
// код у себя и получает копию снимка. Снимок не меняется: правки после отправки другу не видны.
//
//	POST /api/share        {kind, data}  → {code}
//	GET  /api/share/{code}               → {kind, data, by, created}
//
// Трек (kind "track", data {track, room?}) можно открыть и без аккаунта — ссылкой https://{сервер}/t/{code}:
//
//	GET  /api/share/{code}/public        → {kind, data, by, created}   только для kind == "track"
//	GET  /t/{code}                       → HTML-страница; Discord берёт из её <head> превью (og:…)
//
// room — код румы, если человек слушает вместе: друг по ссылке сразу зайдёт к нему.
package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"unicode"
)

const (
	maxTrackShare = 16 * 1024   // трек — снимок и код румы, не больше 16 КБ
	maxShare      = 1024 * 1024 // один снимок — до 1 МБ (альбом на пару тысяч треков)
	maxSharesUser = 500         // старые коды удаляются, когда их больше
	shareCodeLen  = 8
)

var (
	shareKinds  = map[string]bool{"album": true, "eq": true, "track": true}
	shareCodeRe = regexp.MustCompile(`^[` + codeAlphabet + `]{8}$`)
)

// normCode — друг вводит код как угодно: строчными, с дефисом и пробелами
func normCode(code string) string {
	return strings.ToUpper(strings.Map(func(r rune) rune {
		if r == '-' || unicode.IsSpace(r) {
			return -1
		}
		return r
	}, code))
}

// newCode — свободный код в таблице (shares или collabs)
func newCode(q querier, table string) (string, error) {
	for {
		code := randomCode(shareCodeLen)
		taken, err := exists(q, "SELECT 1 FROM "+table+" WHERE code = ?", code)
		if err != nil || !taken {
			return code, err
		}
	}
}

type shareBody struct {
	Kind *string         `json:"kind"`
	Data json.RawMessage `json:"data"`
}

func (b *shareBody) check() error {
	if b.Kind == nil || b.Data == nil {
		return errFormat
	}
	return nil
}

func sharePut(r *http.Request, me Auth) (any, error) {
	var b shareBody
	if err := decode(r, &b); err != nil {
		return nil, err
	}
	if !shareKinds[*b.Kind] {
		return nil, fail(400, "Этим нельзя поделиться")
	}
	data, err := compact(b.Data)
	if err != nil {
		return nil, err
	}
	if len(data) > maxShare {
		return nil, fail(413, "Слишком большой альбом, чтобы поделиться")
	}
	if *b.Kind == "track" {
		d, _ := asObject(b.Data)
		t, ok := asObject(d["track"])
		if !ok || strings.TrimSpace(text(t["title"])) == "" {
			return nil, fail(400, "Нет трека")
		}
		if len(data) > maxTrackShare {
			return nil, fail(413, "Слишком большой трек, чтобы поделиться")
		}
	}
	var code string
	err = tx(func(q *sql.Tx) error {
		var err error
		if code, err = newCode(q, "shares"); err != nil {
			return err
		}
		if _, err := q.Exec("INSERT INTO shares (code, user_id, kind, data, created) VALUES (?, ?, ?, ?, ?)",
			code, me.UserID, *b.Kind, data, now()); err != nil {
			return err
		}
		_, err = q.Exec("DELETE FROM shares WHERE user_id = ? AND code NOT IN "+
			"(SELECT code FROM shares WHERE user_id = ? ORDER BY created DESC, rowid DESC LIMIT ?)",
			me.UserID, me.UserID, maxSharesUser)
		return err
	})
	if err != nil {
		return nil, err
	}
	return M{"code": code}, nil
}

func shareView(row Row) M {
	return M{"kind": row.Str("kind"), "data": json.RawMessage(row.Str("data")), "by": row.Str("name"), "created": row.Int("created")}
}

func shareGet(r *http.Request, me Auth) (any, error) {
	code := normCode(r.PathValue("code"))
	if !shareCodeRe.MatchString(code) {
		return nil, fail(404, "Такого кода нет")
	}
	row, err := one(db, "SELECT s.kind, s.data, s.created, u.name FROM shares s JOIN users u ON u.id = s.user_id WHERE s.code = ?", code)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, fail(404, "Такого кода нет. Проверь буквы или попроси прислать заново")
	}
	return shareView(row), nil
}

// ---------- трек по ссылке: без аккаунта ----------

func publicTrack(code string) (Row, error) {
	code = normCode(code)
	if !shareCodeRe.MatchString(code) {
		return nil, nil
	}
	return one(db, "SELECT s.code, s.kind, s.data, s.created, u.name FROM shares s JOIN users u ON u.id = s.user_id "+
		"WHERE s.code = ? AND s.kind = 'track'", code)
}

func sharePublic(r *http.Request) (any, error) {
	row, err := publicTrack(r.PathValue("code"))
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, fail(404, "Такого трека нет. Попроси прислать ссылку заново")
	}
	return shareView(row), nil
}

var sourceNames = map[string]string{"ym": "Яндекс Музыке", "sc": "SoundCloud", "sp": "Spotify"}

const trackPage = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — авеон</title>
<meta property="og:type" content="music.song">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
{image}<meta property="og:site_name" content="авеон">
<meta name="theme-color" content="#f0a63a">
<meta name="twitter:card" content="summary_large_image">
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #1b1411; color: #f1e6d6;
         font: 16px/1.5 "Segoe UI", system-ui, sans-serif; }
  main { width: min(360px, calc(100vw - 32px)); text-align: center; }
  img, .none { width: 100%; aspect-ratio: 1; border-radius: 20px; object-fit: cover; box-shadow: 0 24px 60px rgb(0 0 0 / .5); background: #2a201b; }
  .none { display: grid; place-items: center; font-size: 64px; color: #8a7a68; }
  h1 { margin: 22px 0 2px; font-size: 22px; }
  p { margin: 0; color: #bfae99; }
  small { display: block; margin-top: 10px; color: #8a7a68; }
  a { display: block; margin-top: 12px; padding: 13px; border-radius: 99px; text-decoration: none; font-weight: 600; }
  .go { margin-top: 24px; background: #f0a63a; color: #1b1411; }
  .alt { background: #33271f; color: #f1e6d6; }
</style></head>
<body><main>
{cover}
<h1>{name}</h1><p>{artist}</p>{by}
<a class="go" href="aveon://track/{code}">Открыть в авеоне</a>
{link}
</main></body></html>`

// esc — как html.escape из Python: & < > " '
var esc = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#x27;").Replace

func renderPage(v map[string]string) string {
	var pairs []string
	for k, val := range v {
		pairs = append(pairs, "{"+k+"}", val)
	}
	return strings.NewReplacer(pairs...).Replace(trackPage)
}

func htmlPage(status int, body string) raw {
	return func(w http.ResponseWriter) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(status)
		w.Write([]byte(body))
	}
}

func trackPageHandler(r *http.Request) (any, error) {
	row, err := publicTrack(r.PathValue("code"))
	if err != nil {
		return nil, err
	}
	if row == nil {
		return htmlPage(404, renderPage(map[string]string{"title": "Трек не найден", "desc": "Ссылка устарела или в ней опечатка",
			"image": "", "cover": `<div class="none">♪</div>`, "name": "Трек не найден",
			"artist": "Попроси прислать ссылку заново", "by": "", "code": "", "link": ""})), nil
	}
	data, _ := asObject(json.RawMessage(row.Str("data")))
	t, _ := asObject(data["track"])
	title, artist := text(t["title"]), text(t["artist"])
	cover := text(t["cover"])
	if !strings.HasPrefix(cover, "https://") {
		cover = ""
	}
	link := text(t["link"])
	if !strings.HasPrefix(link, "https://") && !strings.HasPrefix(link, "http://") {
		link = ""
	}
	together := truthy(data["room"])
	desc := "Слушать в авеоне"
	if together {
		desc += ", вместе с " + row.Str("name")
	}
	full := title
	if artist != "" {
		full = title + " — " + artist
	}
	v := map[string]string{"title": esc(full), "desc": esc(desc), "image": "", "cover": `<div class="none">♪</div>`,
		"name": esc(title), "artist": esc(artist), "code": esc(row.Str("code")), "link": ""}
	if cover != "" {
		v["image"] = `<meta property="og:image" content="` + esc(cover) + "\">\n"
		v["cover"] = `<img src="` + esc(cover) + `" alt="">`
	}
	by := "<small>от " + esc(row.Str("name"))
	if together {
		by += " · слушают вместе"
	}
	v["by"] = by + "</small>"
	if link != "" {
		var source string
		json.Unmarshal(t["source"], &source)
		name, ok := sourceNames[source]
		if !ok {
			name = "сервисе"
		}
		v["link"] = `<a class="alt" href="` + esc(link) + `">Открыть в ` + esc(name) + `</a>`
	}
	return htmlPage(200, renderPage(v)), nil
}
