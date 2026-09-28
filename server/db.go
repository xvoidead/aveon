// SQLite: пользователи, сессии входа, синхронизируемые документы и всё остальное.
//
// Драйвер modernc.org/sqlite написан на чистом Go — сборке не нужен cgo, бинарник собирается одной командой.
package main

import (
	"database/sql"
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schema string

var db *sql.DB

// Колонки, добавленные после первой версии схемы. Новую колонку дописываем в конец —
// openDB добавит её в старые базы
var columns = []struct{ table, col, decl string }{
	{"users", "avatar", "TEXT NOT NULL DEFAULT ''"},
	{"users", "avatar_at", "INTEGER NOT NULL DEFAULT 0"}, // когда меняли: по нему плеер понимает, что кэш устарел
	{"users", "banned", "INTEGER NOT NULL DEFAULT 0"},    // админка: заблокированный не может войти
	{"messages", "edited", "INTEGER NOT NULL DEFAULT 0"}, // когда сообщение изменили, 0 — не меняли
	{"messages", "album", "TEXT"},                        // альбом в сообщении: {code, title, count, cover} — код из share.go
}

func openDB(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	// _txlock=immediate: транзакция сразу берёт блокировку записи — иначе два запроса,
	// начавшие с чтения, упираются друг в друга при записи (SQLITE_BUSY)
	dsn := path + "?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(10000)" +
		"&_pragma=synchronous(NORMAL)&_txlock=immediate"
	var err error
	if db, err = sql.Open("sqlite", dsn); err != nil {
		return err
	}
	db.SetMaxOpenConns(8)
	if _, err := db.Exec(schema); err != nil {
		return fmt.Errorf("schema: %w", err)
	}
	for _, c := range columns {
		rows, err := all(db, "SELECT name FROM pragma_table_info(?)", c.table)
		if err != nil {
			return err
		}
		have := false
		for _, r := range rows {
			have = have || r.Str("name") == c.col
		}
		if !have {
			if _, err := db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", c.table, c.col, c.decl)); err != nil {
				return err
			}
		}
	}
	return nil
}

// querier — и *sql.DB, и *sql.Tx: функции ниже работают и внутри транзакции, и без неё
type querier interface {
	Query(query string, args ...any) (*sql.Rows, error)
	Exec(query string, args ...any) (sql.Result, error)
}

// tx — транзакция: commit, если fn вернула nil, иначе rollback (как `with db.tx()` в старой версии)
func tx(fn func(q *sql.Tx) error) error {
	t, err := db.Begin()
	if err != nil {
		return err
	}
	if err := fn(t); err != nil {
		t.Rollback()
		return err
	}
	return t.Commit()
}

// Row — строка результата по именам колонок. Типы как у драйвера: int64, float64, string, []byte, nil
type Row map[string]any

func (r Row) Int(k string) int64 {
	switch v := r[k].(type) {
	case int64:
		return v
	case float64:
		return int64(v)
	}
	return 0
}

func (r Row) Float(k string) float64 {
	switch v := r[k].(type) {
	case int64:
		return float64(v)
	case float64:
		return v
	}
	return 0
}

func (r Row) Str(k string) string {
	switch v := r[k].(type) {
	case string:
		return v
	case []byte:
		return string(v)
	}
	return ""
}

func (r Row) Null(k string) bool { return r[k] == nil }

func all(q querier, query string, args ...any) ([]Row, error) {
	rows, err := q.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	var out []Row
	for rows.Next() {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		row := make(Row, len(cols))
		for i, c := range cols {
			if b, ok := vals[i].([]byte); ok {
				vals[i] = string(b)
			}
			row[c] = vals[i]
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// one — первая строка или nil, если строк нет
func one(q querier, query string, args ...any) (Row, error) {
	rows, err := all(q, query, args...)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

func count(q querier, query string, args ...any) (int64, error) {
	r, err := one(q, query, args...)
	if err != nil || r == nil {
		return 0, err
	}
	for _, v := range r {
		if n, ok := v.(int64); ok {
			return n, nil
		}
	}
	return 0, nil
}

// placeholders — "?,?,?" для IN (…)
func placeholders(n int) string {
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

func exists(q querier, query string, args ...any) (bool, error) {
	r, err := one(q, query, args...)
	return r != nil, err
}

// ---------- обслуживание ----------

const nowplayingTTL = 180 * 24 * 3600

// cleanup удаляет то, что уже никому не покажется: истёкшие сессии и «что играет» полугодовой давности
func cleanup() (sessions, nowplaying int64, err error) {
	t := time.Now().Unix()
	res, err := db.Exec("DELETE FROM sessions WHERE last_used < ?", t-sessionTTL)
	if err != nil {
		return
	}
	sessions, _ = res.RowsAffected()
	res, err = db.Exec("DELETE FROM nowplaying WHERE at < ?", (t-nowplayingTTL)*1000)
	if err != nil {
		return
	}
	nowplaying, _ = res.RowsAffected()
	return
}

// backup — копия базы на сегодня (VACUUM INTO безопасен на живой базе) и не больше keep старых.
// Пустая строка — сегодня копия уже есть
func backup(dir string, keep int) (string, error) {
	if dir == "" {
		return "", nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	dest := filepath.Join(dir, "aveon-"+time.Now().Format("2006-01-02")+".db")
	if _, err := os.Stat(dest); err == nil {
		return "", nil
	}
	tmp := dest + ".tmp"
	os.Remove(tmp)
	if _, err := db.Exec("VACUUM INTO ?", tmp); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, dest); err != nil {
		return "", err
	}
	old, _ := filepath.Glob(filepath.Join(dir, "aveon-*.db"))
	sort.Strings(old)
	for len(old) > keep {
		os.Remove(old[0])
		old = old[1:]
	}
	return dest, nil
}
