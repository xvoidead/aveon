// Самоцензура: находит в тексте песни мат и упоминания наркотиков и отдаёт отрезки времени,
// на которых окно прячет звук. Время слов: Musixmatch richsync (точно, по словам), иначе строки
// LRCLIB / Musixmatch и оценка места слова внутри строки по слогам.
const config = require('./config');
const texts = require('./services/texts');

// Проверяются слова целиком после нормализации (строчные, ё → е, без знаков по краям).
// Двусмысленные слова (фен, соль, трава, кислота, план…) не трогаем — иначе будет много ложных срабатываний.
const RULES = {
  profanity: [
    /^(на|по|от|за|вы|до|об|при|рас|раз|у|с|недо|пере|под)?ху[йеёяию]/,
    /пизд/,
    /^бля/,
    /^(за|вы|по|у|на|от|до|об|раз|рас|съ|въ|подъ|при|пере|недо|про)?[её]б(а|у|л|н|и|ет|ут|ёт|ош|ыр|ись|ск|ля|о|ен|уч)/,
    /^муд(ак|ил|ач|оз|ох|л)/,
    /^пид(о|а|е)?р/,
    /^педик/,
    /^залуп/,
    /^г[ао]нд[оа]н/,
    /^шлюх/,
    /^шалав/,
    /^сук(а|и|у|е|ой|ам|ами|ах|ин|ина|ины)?$/,
    /^суч(ка|ки|ку|кой|ара|ары|ий|ья|ье)/,
    /^дроч/,
    /^манд(а|у|ой|ы|ец|ец|авошк)$/,
    /^(motha|mother|muth[ae])?f+u+c*k/,
    /^fuk/,
    /^(bull)?shit/,
    /^bitch/,
    /^cunt/,
    /^dick(s|head|heads)?$/,
    /^puss(y|ies)$/,
    /^ass(hole|holes)?$/,
    /^nigg/,
    /^whore/,
    /^slut/,
  ],
  drugs: [
    /^нарко(т|ман|ша)/,
    /^нарик/,
    /^героин/,
    /^гер(ыч|ыча|ычем)$/,
    /^кокаин/,
    /^кокс(а|ом|у)?$/,
    /^мефедрон/,
    /^меф(а|ом|у|чик)?$/,
    /^гашиш/,
    /^марихуан/,
    /^мариван/,
    /^ганж/,
    /^дур(ь|и|ью)$/,
    /^спайс/,
    /^(мет)?амфетамин/,
    /^экстази/,
    /^мдма$/,
    /^лсд$/,
    /^закладк/,
    /^барыг/,
    /^опиум/,
    /^метадон/,
    /^кодеин/,
    /^трамадол/,
    /^ксанакс/,
    /^cocaine/,
    /^coke$/,
    /^heroin/,
    /^meth$/,
    /^methamphetamine/,
    /^molly$/,
    /^mdma$/,
    /^lsd$/,
    /^xan(ax|axes|ny|s)?$/,
    /^perc(s|ocet|ocets|30s?)?$/,
    /^lean$/,
    /^codeine/,
    /^weed$/,
    /^blunts?$/,
    /^kush$/,
    /^ecstasy/,
    /^oxy(contin|cotton)?$/,
    /^fentanyl/,
    /^ketamine/,
    /^shrooms?$/,
    /^opioids?$/,
    /^marijuana/,
    /^cannabis/,
    /^ganja$/,
    /^thc$/,
  ],
};

function norm(w) {
  return String(w || '').toLowerCase().replace(/ё/g, 'е').replace(/^[^\p{L}\p{N}*]+|[^\p{L}\p{N}*]+$/gu, '');
}

function matcher(opts) {
  const rules = [...(opts.profanity ? RULES.profanity : []), ...(opts.drugs ? RULES.drugs : [])];
  const custom = (opts.custom || []).map(norm).filter((w) => w.length >= 2);
  return (word) => {
    const w = norm(word);
    if (!w) return false;
    // В текстах мат часто уже скрыт звёздочками: «бл*ть», «f**k»
    if (opts.profanity && /\p{L}\*+/u.test(w)) return true;
    const parts = [w, ...w.split('-').filter(Boolean)];
    return parts.some((p) => rules.some((r) => r.test(p)) || custom.some((c) => p.startsWith(c)));
  };
}

function parseLRC(text) {
  const lines = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (!tags.length) continue;
    const words = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of tags) lines.push({ t: +m[1] * 60 + parseFloat(m[2].replace(':', '.')), text: words });
  }
  return lines.sort((a, b) => a.t - b.t);
}

const syllables = (w) => Math.max(1, (norm(w).match(/[аеиоуыэюяaeiouy]/g) || []).length);

// Отрезки [начало, конец] в секундах
function fromWords(lines, bad, scope) {
  const out = [];
  for (const l of lines) {
    if (!l.words.some((w) => bad(w.text))) continue;
    if (scope === 'line') { out.push([l.ts - 0.1, l.te + 0.1]); continue; }
    l.words.forEach((w, i) => {
      if (!bad(w.text)) return;
      const next = l.words[i + 1]?.t ?? l.te;
      out.push([w.t - 0.06, Math.min(next, w.t + 1.2, l.te + 0.3) + 0.08]);
    });
  }
  return out;
}

function fromLines(lrc, bad, scope, duration) {
  const lines = parseLRC(lrc);
  const out = [];
  lines.forEach((l, i) => {
    const words = l.text.split(/\s+/).filter(Boolean);
    if (!words.some(bad)) return;
    const gap = (lines[i + 1]?.t ?? duration ?? l.t + 6) - l.t;
    const total = words.reduce((s, w) => s + syllables(w), 0);
    // Длительность пропевания строки: не дольше, чем до следующей строки
    const sung = Math.max(0.5, Math.min(gap, total * 0.3 + 0.5));
    if (scope === 'line') { out.push([l.t - 0.1, l.t + sung + 0.3]); return; }
    let before = 0;
    for (const w of words) {
      const s = syllables(w);
      if (bad(w)) out.push([l.t + (sung * before) / total - 0.35, l.t + (sung * (before + s)) / total + 0.35]);
      before += s;
    }
  });
  return out;
}

function merge(list) {
  const sorted = list.map(([s, e]) => [Math.max(0, s), e]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w[0] <= last[1] + 0.05) last[1] = Math.max(last[1], w[1]);
    else out.push(w);
  }
  return out;
}

// Время слов — из того же текста, что показывает панель (services/texts.js)
async function source(track) {
  let t = null;
  try { t = await texts.find(track); } catch (e) { console.warn('текст для цензуры:', e.message); }
  if (t?.words) return { from: t.from, precise: true, lines: t.words };
  if (t?.synced) return { from: t.from, precise: false, lrc: t.synced };
  return null;
}

async function plan(track) {
  const opts = config.get().censor;
  const src = await source(track);
  if (!src) return { from: null, precise: false, windows: [] };
  const bad = matcher(opts);
  const raw = src.lines
    ? fromWords(src.lines, bad, opts.scope)
    : fromLines(src.lrc, bad, opts.scope, track.duration);
  return { from: src.from, precise: src.precise, hits: raw.length, windows: merge(raw) };
}

module.exports = { plan, matcher, fromWords, fromLines, merge };
