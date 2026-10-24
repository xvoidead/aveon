// Чистая часть «колонки» (src/speaker.js): без electron, сети и ssh, поэтому проверяется node --test (npm run test:speaker).
// Колонка — Яндекс Станция Лайт 2 по SSH. У неё нет TLS и нет прямого пути к аудио-CDN SoundCloud, поэтому звук
// отдаёт этот компьютер, а здесь — всё, что нужно для этого: плейлисты, диапазоны, команды ssh и скрипты для колонки.

const MIME = {
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
  '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.webm': 'audio/webm', '.weba': 'audio/webm',
};

// Порт на колонке, куда обратный SSH-туннель выводит наш сервер. Не порт самой колонки: у Яндекса заняты 9850…9926
const REMOTE_PORT = 19790;
const STATE_DIR = '/tmp/aveon-speaker';
const MASTER = 186; // numid «Master Playback Volume» (softvol 0…255) у Станции Лайт 2

// Имя из ~/.ssh/config или адрес. Дефис в начале нельзя: ssh принял бы его за ключ
const validHost = (h) => typeof h === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_.@:-]*$/.test(h);

// Доля 0…1 → значение Master 0…255. Не число или пустое — 0.7: на таком уровне музыка звучит как привычно
function masterOf(level) {
  const x = typeof level === 'number' && Number.isFinite(level) ? level : 0.7;
  return Math.round(Math.min(1, Math.max(0, x)) * 255);
}

// Range: bytes=a-b | a- | -n. undefined — диапазона нет, null — не годится (416)
function parseRange(header, size) {
  const m = header && /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || !(m[1] || m[2])) return undefined;
  let start = m[1] ? parseInt(m[1], 10) : size - parseInt(m[2], 10);
  let end = m[1] && m[2] ? parseInt(m[2], 10) : size - 1;
  start = Math.max(0, start);
  end = Math.min(end, size - 1);
  return start > end ? null : { start, end };
}

// Куда указывает media://… из resolveStream: файл кэша или локальный файл (те же проверки, что в протоколе main.js).
// Строка — путь, null — media://, но отдавать нельзя, undefined — это не media://, адрес обычный
function mediaFile(url, { cacheFileOf, isAllowed }) {
  let u;
  try { u = new URL(url); } catch { return undefined; }
  if (u.protocol !== 'media:') return undefined;
  if (u.hostname === 'cache') return cacheFileOf(u.searchParams.get('f'));
  if (u.hostname === 'local') {
    const p = u.searchParams.get('p') || '';
    return isAllowed(p) ? p : null;
  }
  return null;
}

const isPlaylist = (type, url) => /mpegurl/i.test(type || '') || /\.m3u8?(\?|$)/i.test(url || '');

// Начать трек не с начала: плеер колонки запускается одной строкой конвейера и команд после запуска не принимает —
// перемотать его нечем, поэтому выкидываем из плейлиста сегменты до нужной секунды.
// Точность — до начала сегмента (у SoundCloud это 10 секунд), сколько получилось на самом деле — в offset.
// Плейлист без #EXTINF (список качеств) не трогаем: обрежется тот, на который он сошлётся
function trimPlaylist(text, at) {
  const lines = text.split(/\r?\n/);
  if (!(at > 0) || !lines.some((l) => l.startsWith('#EXTINF'))) return { text, offset: 0 };
  const out = [];
  let acc = 0;
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^#EXTINF:([\d.]+)/.exec(lines[i]);
    if (!m) { out.push(lines[i]); continue; }
    const dur = Number(m[1]) || 0;
    let j = i + 1;
    while (j < lines.length && (!lines[j].trim() || lines[j].startsWith('#'))) j++; // ссылка сегмента
    if (acc + dur <= at) { offset = acc += dur; i = j; continue; } // сегмент целиком раньше нужной секунды
    out.push(...lines.slice(i, j + 1));
    acc += dur;
    i = j;
  }
  return { text: out.join('\n'), offset };
}

// HLS-плейлист для колонки: каждую ссылку (сегменты, init, вложенные плейлисты) меняем на адрес нашего сервера.
// register(url) запоминает настоящий адрес и возвращает новый. Относительные ссылки считаем от адреса самого плейлиста
function rewritePlaylist(text, baseUrl, register) {
  const swap = (u) => {
    if (!u) return u;
    let abs;
    try { abs = new URL(u, baseUrl).href; } catch { return u; }
    return /^https?:/.test(abs) ? register(abs) : u; // skd://, data: и прочее оставляем как есть
  };
  return text.split(/\r?\n/).map((line) => {
    if (!line.trim()) return line;
    if (line.startsWith('#')) return line.replace(/URI="([^"]*)"/g, (m, u) => `URI="${swap(u)}"`);
    return swap(line.trim());
  }).join('\n');
}

// ---- ssh ----

const BASE = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];

// Скрипт идёт в stdin: так не нужно экранировать кавычки для удалённой оболочки
const controlArgs = (host) => [...BASE, host, 'sh', '-s'];

// Колонка ходит на свой 127.0.0.1:REMOTE_PORT, туннель приводит её к нашему серверу на localPort
const tunnelArgs = (host, localPort) => [
  '-N', ...BASE, '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
  '-R', `${REMOTE_PORT}:127.0.0.1:${localPort}`, host,
];

// ---- скрипты для колонки (busybox sh) ----

// maind --gst-launch на сигнал выходит, не закрыв звук как положено, и в системе остаются общая память и семафор
// микшера dmix (ключи 0x400, 0x401). Следующие клиенты цепляются к ним, устройство готовится, а запуск потока до
// железа не доходит: молчит и плеер, и сама Алиса, пока не перезапустить quasar. Сироту убираем сразу после выхода
// плеера. Трогаем только когда к памяти никто не подключён (nattch = 0): у живого сервера он не ноль.
// На конце трека maind выходит сам и убирает за собой, там сирот нет
const DMIX_CLEAN = `dmix_clean() {
  N=$(ipcs -m | grep -E '^0x0*400 ' | sed 's/  */ /g' | cut -d' ' -f6)
  [ "$N" = 0 ] && ipcrm -M 0x400 -M 0x401 -S 0x400 2>/dev/null
  return 0
}`;

// Часы колонки (36 белых светодиодов: 4 цифры по 7 сегментов A..G + двоеточие DH/DL) показывают время трека мм:сс.
// Прошивка перерисовывает время раз в минуту, а мы рисуем каждую секунду, так что после конца трека кладём обычное время
// обратно сами. led.sh show <секунд> — время трека, led.sh clock — обычные часы (пояс +3, как в led-clockface.sh)
const LED = `#!/bin/sh
L=/sys/class/leds/plum:white:clock
BRIGHT=$LEDB
[ -n "$BRIGHT" ] || BRIGHT=60
ALL="A0 A1 A2 A3 B0 B1 B2 B3 C0 C1 C2 C3 D0 D1 D2 D3 E0 E1 E2 E3 F0 F1 F2 F3 G0 G1 G2 G3 DH DL DEGREE"
segs() {
  case "$1" in
    0) echo A B C D E F ;; 1) echo B C ;; 2) echo A B D E G ;; 3) echo A B C D G ;; 4) echo B C F G ;;
    5) echo A C D F G ;; 6) echo A C D E F G ;; 7) echo A B C ;; 8) echo A B C D E F G ;; 9) echo A B C D F G ;;
  esac
}
draw() {
  want=""
  i=0
  for d in $1 $2 $3 $4; do
    for s in $(segs $d); do want="$want $s$i"; done
    i=$((i + 1))
  done
  [ "$5" = 1 ] && want="$want DH DL"
  for s in $ALL; do
    case " $want " in *" $s "*) v=$BRIGHT ;; *) v=0 ;; esac
    echo $v > $L$s/brightness 2>/dev/null
  done
}
case "$1" in
  show)
    S=$2
    m=$(( (S / 60) % 100 ))
    sec=$((S % 60))
    draw $((m / 10)) $((m % 10)) $((sec / 10)) $((sec % 10)) $((1 - S % 2))
    ;;
  clock)
    h=$(( ($(date -u +%H) + 3) % 24 ))
    mi=$(date -u +%M)
    draw $((h / 10)) $((h % 10)) $(echo $mi | cut -c1) $(echo $mi | cut -c2) 1
    ;;
esac`;

// Смотритель: играет поток и сам возвращает громкость, когда трек закончился или плеер остановили.
// maind --gst-launch завершается сам на конце потока (в логе «EOS»), поэтому конец трека ловить не нужно
const RUN = `#!/bin/sh
export LD_LIBRARY_PATH=/system/vendor/quasar/libs GST_PLUGIN_PATH=/system/vendor/quasar/libs
D=${STATE_DIR}
${DMIX_CLEAN}
echo $$ > $D/pid
/system/vendor/quasar/maind --gst-launch "uridecodebin uri=$1 ! audioconvert ! audioresample ! alsasink" > $D/gst.log 2>&1 < /dev/null &
G=$!
T=$(basename "$1")
B=http://127.0.0.1:${REMOTE_PORT}
KILLED=
trap 'KILLED=1; kill $G 2>/dev/null' TERM INT
# рукопожатие: колонка сама сообщает компьютеру позицию трека (строка Progress в логе плеера, раз в секунду)
LOG=/data/quasar/daemons_logs/maind.log
(
  LAST=
  # двойной тап по громкости: два «Button click» одной кнопки не позже чем через 0.8 с — /b/<токен>?k=up|down
  LASTB=$(tail -n 40 $LOG 2>/dev/null | grep 'Button click: volume_' | tail -n 1)
  OFF=
  PK=
  PT=0
  while kill -0 $G 2>/dev/null; do
    if [ "$3" = 1 ]; then
      BL=$(tail -n 40 $LOG 2>/dev/null | grep 'Button click: volume_' | tail -n 1)
      if [ -n "$BL" ] && [ "$BL" != "$LASTB" ]; then
        LASTB=$BL
        case "$BL" in *volume_up) K=up ;; *) K=down ;; esac
        TM=$(echo "$BL" | awk '{t=$3; sub("]","",t); split(t,a,":"); split(a[3],b,"."); print ((a[1]*60+a[2])*60+b[1])*1000+b[2]}')
        DT=$((TM - PT))
        if [ "$K" = "$PK" ] && [ $DT -ge 0 ] && [ $DT -le 800 ]; then
          PK=
          PT=0
          wget -q -T 2 -O /dev/null "$B/b/$T?k=$K" 2>/dev/null
          # два тапа сдвинули громкость на два шага: возвращаем ту, что была у трека
          ( sleep 0.3; amixer cset numid=${MASTER} "$(cat $D/lvl)" >/dev/null 2>&1 ) &
        else
          PK=$K
          PT=$TM
        fi
      fi
    fi
    L=$(tail -n 5 $D/gst.log 2>/dev/null | grep 'Progress:' | tail -n 1)
    if [ -n "$L" ] && [ "$L" != "$LAST" ]; then
      LAST=$L
      P=$(echo "$L" | awk '{for(i=1;i<=NF;i++) if($i=="Progress:"){v=$(i+1); sub("ms","",v); print v}}')
      wget -q -T 2 -O /dev/null "$B/p/$T?ms=$P" 2>/dev/null
      # плеер считает время своего куска с нуля: с какой секунды трека он начат, знает компьютер — спрашиваем один раз
      [ -z "$OFF" ] && OFF=$(wget -q -T 2 -O - "$B/o/$T" 2>/dev/null)
      [ -z "$OFF" ] && OFF=0
      [ "$2" = 1 ] && sh $D/led.sh show $(((P + OFF) / 1000))
    fi
    sleep 0.1
  done
) &
wait $G
wait $G 2>/dev/null
dmix_clean
[ "$2" = 1 ] && sh $D/led.sh clock
# трек кончился сам (не остановили): сразу даём знать, чтобы Авеон включил следующий
[ -z "$KILLED" ] && wget -q -T 2 -O /dev/null "$B/e/$T" 2>/dev/null
V=$(cat $D/vol 2>/dev/null)
[ -n "$V" ] && amixer cset numid=${MASTER} "$V" >/dev/null 2>&1
rm -f $D/vol $D/pid`;

const PLAY_URL = new RegExp(`^http://127\\.0\\.0\\.1:${REMOTE_PORT}/s/[0-9a-f]{32}$`);

function playScript({ url, level, display, keys }) {
  if (!PLAY_URL.test(url)) throw new Error('bad play url');
  return `D=${STATE_DIR}
mkdir -p $D
${DMIX_CLEAN}
if [ -f $D/pid ]; then
  OLD=$(cat $D/pid)
  kill $OLD 2>/dev/null
  i=0
  while kill -0 $OLD 2>/dev/null && [ $i -lt 30 ]; do sleep 0.1; i=$((i + 1)); done
fi
dmix_clean
[ -f $D/vol ] || amixer cget numid=${MASTER} | grep -E '^  : values=' | sed 's/.*values=//' | cut -d, -f1 > $D/vol
[ -n "$(cat $D/vol)" ] || { rm -f $D/vol; echo "FAIL volume"; exit 1; }
cat > $D/run.sh <<'EOF'
${RUN}
EOF
cat > $D/led.sh <<'LEDEOF'
${LED}
LEDEOF
echo ${masterOf(level)} > $D/lvl
amixer cset numid=${MASTER} ${masterOf(level)} >/dev/null 2>&1
# туннель с компьютера поднимается параллельно этому скрипту: ждём его порт здесь, а не отдельными запросами по ssh
i=0
while ! grep -qi ':${HEX_PORT} 00000000:0000 0A ' /proc/net/tcp && [ $i -lt 80 ]; do sleep 0.1; i=$((i + 1)); done
grep -qi ':${HEX_PORT} 00000000:0000 0A ' /proc/net/tcp || { echo "FAIL tunnel"; exit 1; }
: > $D/gst.log
rm -f $D/pid
setsid sh $D/run.sh ${url} ${display ? 1 : 0} ${keys ? 1 : 0} > /dev/null 2>&1 < /dev/null &
# готово, когда плеер написал первую строку Progress (звук пошёл) или умер: без фиксированного ожидания
i=0
while [ $i -lt 100 ]; do
  P=$(cat $D/pid 2>/dev/null)
  if [ -n "$P" ] && ! kill -0 $P 2>/dev/null; then break; fi
  grep -q 'Progress:' $D/gst.log 2>/dev/null && break
  sleep 0.1; i=$((i + 1))
done
P=$(cat $D/pid 2>/dev/null)
if [ -n "$P" ] && kill -0 $P 2>/dev/null && grep -q 'Progress:' $D/gst.log 2>/dev/null; then echo "OK $P"; else echo FAIL; grep -iE 'error' $D/gst.log | tail -n 2 | cut -c1-200; fi
`;
}

const stopScript = () => `D=${STATE_DIR}
${DMIX_CLEAN}
if [ -f $D/pid ]; then
  P=$(cat $D/pid)
  kill $P 2>/dev/null
  i=0
  while kill -0 $P 2>/dev/null && [ $i -lt 30 ]; do sleep 0.1; i=$((i + 1)); done
  dmix_clean
  echo STOPPED
else
  dmix_clean
  echo IDLE
fi
`;

// Громкость ползунком приложения, пока трек играет: в $D/lvl её же берёт смотритель после двойного тапа
const volumeScript = (level) => `D=${STATE_DIR}
mkdir -p $D
echo ${masterOf(level)} > $D/lvl
[ -f $D/vol ] && amixer cset numid=${MASTER} ${masterOf(level)} >/dev/null 2>&1
echo VOL
`;

const statusScript = () => `D=${STATE_DIR}
if [ -f $D/pid ] && kill -0 $(cat $D/pid) 2>/dev/null; then
  echo PLAYING
  tail -n 30 $D/gst.log 2>/dev/null | grep 'Progress:' | tail -n 1
else echo IDLE; fi
`;

// Вывел ли туннель наш порт на колонке: в /proc/net/tcp порт стоит в шестнадцатеричном виде, 0A — LISTEN
const HEX_PORT = REMOTE_PORT.toString(16).toUpperCase().padStart(4, '0');
const listenScript = () => `grep -qi ':${HEX_PORT} 00000000:0000 0A ' /proc/net/tcp && echo UP || echo DOWN
`;

function playResult(out) {
  const text = String(out || '').trim();
  if (/^OK \d+/m.test(text)) return { ok: true };
  return { ok: false, error: text.split('\n').filter(Boolean).slice(-2).join(' ') || 'нет ответа от колонки' };
}

const isPlaying = (out) => /^PLAYING/m.test(String(out || ''));

// Позиция трека, секунды: плеер сам пишет в gst.log раз в секунду «Progress: 5256ms / 124238ms». null — строки ещё нет
function progressOf(out) {
  const m = /Progress: (\d+)ms \//.exec(String(out || ''));
  return m ? Number(m[1]) / 1000 : null;
}

module.exports = {
  MIME, REMOTE_PORT, validHost, masterOf, parseRange, mediaFile, isPlaylist, rewritePlaylist, trimPlaylist, volumeScript,
  controlArgs, tunnelArgs, playScript, stopScript, statusScript, listenScript, playResult, isPlaying, progressOf,
};
