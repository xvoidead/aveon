// Письма: коды подтверждения почты и сброса пароля. Отправляем через SMTP с STARTTLS и логином
// (на aveon.su — Mailu, ящик noreply@aveon.su). Без AVEON_SMTP_HOST почта выключена.
package main

import (
	"bytes"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"html"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"strings"
	"time"
)

type mailConfig struct {
	host, port, user, pass string
	from                   mail.Address
}

var mailer mailConfig

func setupMail() error {
	mailer = mailConfig{host: env("AVEON_SMTP_HOST", ""), port: env("AVEON_SMTP_PORT", "587"),
		user: env("AVEON_SMTP_USER", ""), pass: env("AVEON_SMTP_PASS", "")}
	if mailer.host == "" {
		return nil
	}
	from, err := mail.ParseAddress(env("AVEON_SMTP_FROM", mailer.user))
	if err != nil {
		return fmt.Errorf("AVEON_SMTP_FROM: %w", err)
	}
	mailer.from = *from
	return nil
}

func mailEnabled() bool { return mailer.host != "" }

// sendMail — одно письмо из текстовой и HTML-версии. Таймаут на всё 20 секунд: запрос не должен висеть
func sendMail(to, subject, text, htmlBody string) error {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(mailer.host, mailer.port), 10*time.Second)
	if err != nil {
		return err
	}
	conn.SetDeadline(time.Now().Add(20 * time.Second))
	c, err := smtp.NewClient(conn, mailer.host)
	if err != nil {
		conn.Close()
		return err
	}
	defer c.Close()
	if err := c.Hello("aveon"); err != nil {
		return err
	}
	if ok, _ := c.Extension("STARTTLS"); ok {
		if err := c.StartTLS(&tls.Config{ServerName: mailer.host, MinVersion: tls.VersionTLS12}); err != nil {
			return err
		}
	}
	if mailer.user != "" {
		// PlainAuth сам откажется слать пароль без TLS (кроме localhost)
		if err := c.Auth(smtp.PlainAuth("", mailer.user, mailer.pass, mailer.host)); err != nil {
			return err
		}
	}
	if err := c.Mail(mailer.from.Address); err != nil {
		return err
	}
	if err := c.Rcpt(to); err != nil {
		return err
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(buildMessage(to, subject, text, htmlBody)); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}

func buildMessage(to, subject, text, htmlBody string) []byte {
	var b bytes.Buffer
	boundary := "aveon-" + randomHex(12)
	domain := mailer.from.Address[strings.LastIndexByte(mailer.from.Address, '@')+1:]
	hdr := func(k, v string) { fmt.Fprintf(&b, "%s: %s\r\n", k, v) }
	hdr("From", mailer.from.String())
	hdr("To", to)
	hdr("Subject", mime.BEncoding.Encode("utf-8", subject))
	hdr("Date", time.Now().Format(time.RFC1123Z))
	hdr("Message-ID", "<"+randomHex(16)+"@"+domain+">")
	hdr("MIME-Version", "1.0")
	hdr("Auto-Submitted", "auto-generated") // автоответчики не отвечают на служебные письма
	hdr("Content-Type", `multipart/alternative; boundary="`+boundary+`"`)
	b.WriteString("\r\n")
	for _, part := range []struct{ typ, body string }{{"text/plain", text}, {"text/html", htmlBody}} {
		fmt.Fprintf(&b, "--%s\r\nContent-Type: %s; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n", boundary, part.typ)
		enc := base64.StdEncoding.EncodeToString([]byte(part.body))
		for len(enc) > 76 {
			b.WriteString(enc[:76] + "\r\n")
			enc = enc[76:]
		}
		b.WriteString(enc + "\r\n")
	}
	fmt.Fprintf(&b, "--%s--\r\n", boundary)
	return b.Bytes()
}

// Письмо с кодом в стиле плеера: знак «A» и «авеон», заголовок строчными, код — шесть ячеек,
// как на экране ввода кода. Светлое; почтовики, которые умеют prefers-color-scheme, показывают тёмное.
// Код ещё и в превью-строке и в текстовой версии — его можно скопировать целиком
const mailIcon = "https://music.aveon.su/assets/img/icon.png"

const mailCSS = `:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme:dark){
.bg{background:#000!important}.card{background:#1c1c1e!important}
.ink{color:#f5f5f7!important}.ink2{color:#c7c7cc!important}.ink3{color:#8e8e93!important}
.cell{background:#2c2c2e!important;color:#f5f5f7!important}.line{border-color:#38383a!important}}`

// codeMail — заголовок, одна строка «зачем этот код», шесть ячеек и приписка «если это не ты»
func codeMail(title, lead, code, note string) (text, htmlBody string) {
	text = fmt.Sprintf("%s\n\n%s\n\n    %s\n\nКод действует 15 минут.\n%s\n\n— авеон · music.aveon.su\n", title, lead, code, note)
	e := html.EscapeString
	font := `font-family:'Onest',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`
	var cells strings.Builder
	for i, d := range code {
		pad := ""
		if i > 0 {
			pad = `<td width="6" style="width:6px;font-size:0;line-height:0">&nbsp;</td>`
		}
		fmt.Fprintf(&cells, `%s<td class="cell" align="center" valign="middle" width="40" height="54" style="width:40px;height:54px;`+
			`background:#f2f2f5;border-radius:12px;color:#1c1c1e;%s;font-size:26px;font-weight:700;line-height:54px">%s</td>`,
			pad, font, e(string(d)))
	}
	htmlBody = `<!doctype html><html lang="ru"><head><meta charset="utf-8">` +
		`<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark">` +
		`<meta name="supported-color-schemes" content="light dark">` +
		`<link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;600;700&display=swap" rel="stylesheet">` +
		`<style>` + mailCSS + `</style></head>` +
		`<body class="bg" style="margin:0;padding:0;background:#f2f2f5">` +
		// превью в списке писем: код и срок, а не начало вёрстки
		`<div style="display:none;max-height:0;overflow:hidden;opacity:0">` + e(code) + ` — ` + e(lead) + ` Действует 15 минут.</div>` +
		`<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f5"><tr><td align="center" style="padding:40px 16px">` +
		`<table role="presentation" class="card" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border-radius:28px">` +
		// знак и слово «авеон»
		`<tr><td style="padding:28px 28px 0"><table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
		`<td width="36" style="width:36px"><img src="` + mailIcon + `" width="36" height="36" alt="A" style="display:block;border:0;border-radius:9px;background:#0e0e0e"></td>` +
		`<td class="ink" style="padding-left:10px;` + font + `;font-size:17px;font-weight:700;letter-spacing:-0.02em;color:#1c1c1e">авеон</td>` +
		`</tr></table></td></tr>` +
		`<tr><td class="ink" style="padding:28px 28px 8px;` + font + `;font-size:28px;font-weight:700;letter-spacing:-0.03em;line-height:1.15;color:#1c1c1e">` + e(title) + `</td></tr>` +
		`<tr><td class="ink2" style="padding:0 28px 26px;` + font + `;font-size:15px;line-height:1.55;color:#5c5c62">` + e(lead) + `</td></tr>` +
		`<tr><td style="padding:0 28px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>` + cells.String() + `</tr></table></td></tr>` +
		`<tr><td class="ink3" style="padding:14px 28px 0;` + font + `;font-size:13px;color:#8e8e93">Код действует 15 минут.</td></tr>` +
		`<tr><td style="padding:26px 28px 0"><div class="line" style="border-top:1px solid #ececf0;font-size:0;line-height:0">&nbsp;</div></td></tr>` +
		`<tr><td class="ink3" style="padding:18px 28px 30px;` + font + `;font-size:13px;line-height:1.5;color:#8e8e93">` + e(note) + `</td></tr>` +
		`</table>` +
		`<div class="ink3" style="` + font + `;font-size:12px;color:#8e8e93;padding-top:18px">` +
		`<a href="https://music.aveon.su" style="color:#8e8e93;text-decoration:none">music.aveon.su</a></div>` +
		`</td></tr></table></body></html>`
	return
}
