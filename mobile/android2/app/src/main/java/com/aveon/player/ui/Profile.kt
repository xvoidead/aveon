package com.aveon.player.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.aveon.player.Engine
import com.aveon.player.Panel
import com.aveon.player.Track
import com.aveon.player.objects
import com.aveon.player.str
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import kotlin.math.min
import kotlin.math.roundToInt

// Профиль на телефоне — как в Instagram/TikTok: аватар с кольцом, цифры, кнопки,
// под ними вкладки значками: любимое (сетка обложек), статистика, подключено, устройства.
// Данные и действия — из движка (renderer/native.js → profileData / profileTap), страница там открыта, но не видна.

private class Conn(val id: String, val name: String, val detail: String, val on: Boolean, val brand: String)
private class Device(val name: String, val current: Boolean, val ago: String)
private class ArtistStat(val name: String, val sec: Int, val text: String, val cover: String)
private class Month(
    val key: String, val label: String, val current: Boolean, val canPrev: Boolean, val canNext: Boolean,
    val total: Int, val totalText: String, val avgText: String, val plays: Int, val activeDays: Int, val allTimeText: String,
    val days: List<Int>, val today: Int, val tracks: List<Track>, val plays30: List<Int>, val artists: List<ArtistStat>,
)
private class Prof(
    val name: String, val login: String, val avatar: String, val host: String, val sync: String, val error: String,
    val syncing: Boolean, val admin: Boolean, val keys: String, val friends: Int,
    val conns: List<Conn>, val devices: List<Device>?, val devicesError: String, val month: Month,
)

private fun parse(o: JSONObject): Prof {
    val m = o.optJSONObject("month") ?: JSONObject()
    val tr = m.optJSONArray("tracks").objects()
    val days = m.optJSONArray("days")
    return Prof(
        o.str("name"), o.str("login"), o.str("avatar"), o.str("host"), o.str("sync"), o.str("error"),
        o.optBoolean("syncing"), o.optBoolean("admin"), o.optString("keys", "ok"), o.optInt("friends"),
        o.optJSONArray("conns").objects().map { Conn(it.str("id"), it.str("name"), it.str("detail"), it.optBoolean("on"), it.str("brand")) },
        if (o.isNull("devices")) null else o.optJSONArray("devices").objects().map { Device(it.str("name"), it.optBoolean("current"), it.str("ago")) },
        o.str("devicesError"),
        Month(
            m.str("key"), m.str("label"), m.optBoolean("current"), m.optBoolean("canPrev"), m.optBoolean("canNext"),
            m.optInt("total"), m.str("totalText"), m.str("avgText"), m.optInt("plays"), m.optInt("activeDays"), m.str("allTimeText"),
            if (days == null) emptyList() else (0 until days.length()).map { days.optInt(it) }, m.optInt("today"),
            tr.mapNotNull { Track.of(it) }, tr.map { it.optInt("plays") },
            m.optJSONArray("artists").objects().map { ArtistStat(it.str("name"), it.optInt("sec"), it.str("text"), it.str("cover")) },
        ),
    )
}

private enum class PTab { Loved, Stats, Conn, Devices }

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ProfileScreen(panel: Panel) {
    val p = LocalPal.current
    var shown by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { shown = true }
    var data by remember { mutableStateOf<Prof?>(null) }
    var mk by remember { mutableStateOf("") }
    var tab by remember { mutableStateOf(PTab.Loved) }
    var menu by remember { mutableStateOf(false) }
    var avatarMenu by remember { mutableStateOf(false) }
    var crop by remember { mutableStateOf<Bitmap?>(null) }
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    // движок перерисовал страницу (синхронизация, устройства, аватар) — перечитываем
    LaunchedEffect(panel, mk) { Engine.obj("profileData", mk.ifEmpty { null })?.let { data = parse(it) } }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch { crop = withContext(Dispatchers.IO) { loadBitmap(ctx, uri) } ?: run { Engine.toast("Картинка не открылась", true); null } }
    }
    val swipe = with(LocalDensity.current) { 90.dp.toPx() }

    AnimatedVisibility(
        shown,
        enter = slideInHorizontally(spring(dampingRatio = 0.92f, stiffness = 340f)) { it },
        exit = slideOutHorizontally(tween(260)) { it } + fadeOut(tween(260)),
    ) {
        Box(Modifier.fillMaxSize().background(p.bg).absorb()) {
            val d = data
            if (d == null) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Spinner() }
            else {
                val state = rememberLazyListState()
                LazyColumn(
                    // сверху отступ под полосу: вкладки прилипают прямо под неё
                    Modifier.fillMaxSize().statusBarsPadding().padding(top = 48.dp).pointerInput(Unit) {
                        // свайп влево-вправо по странице — соседняя вкладка, как в Instagram
                        var dx = 0f
                        detectHorizontalDragGestures(
                            onDragStart = { dx = 0f },
                            onDragEnd = {
                                val i = tab.ordinal + if (dx < -swipe) 1 else if (dx > swipe) -1 else 0
                                tab = PTab.entries[i.coerceIn(0, PTab.entries.lastIndex)]
                            },
                        ) { _, a -> dx += a }
                    },
                    state = state,
                    contentPadding = PaddingValues(bottom = 60.dp),
                ) {
                    item { Header(d, onAvatar = { avatarMenu = true }) }
                    stickyHeader { Tabs(tab) { tab = it } }
                    when (tab) {
                        PTab.Loved -> loved(d, onMonth = { mk = it })
                        PTab.Stats -> statsTab(d, onMonth = { mk = it })
                        PTab.Conn -> connTab(d)
                        PTab.Devices -> devicesTab(d)
                    }
                }
                // полоса сверху: назад, @логин, «ещё»
                Box(Modifier.fillMaxWidth().background(p.bg).statusBarsPadding().height(48.dp)) {
                    IconBtn(G.chevronL, Modifier.align(Alignment.CenterStart).padding(start = 4.dp), tint = p.text, iconSize = 20.dp) { Engine.closePanel(panel.key) }
                    Row(Modifier.align(Alignment.Center), verticalAlignment = Alignment.CenterVertically) {
                        Txt(if (d.login.isNotEmpty()) "@${d.login}" else d.name, A.headline, p.text, maxLines = 1)
                    }
                    IconBtn(G.ellipsis, Modifier.align(Alignment.CenterEnd).padding(end = 4.dp), tint = p.text, iconSize = 20.dp) { menu = true }
                }
            }

            // «ещё»: настройки, что нового, админка, аккаунт
            SheetHost(menu, { menu = false }) {
                val acts = buildList {
                    add(Triple(AIcons.settings, "Настройки", "#pf-settings"))
                    add(Triple(AIcons.list, "Что нового", "#pf-changelog"))
                    if (data?.admin == true) add(Triple(AIcons.shield, "Админка", "#pf-admin"))
                    add(Triple(AIcons.keys, "Сменить пароль", "#pf-password"))
                    add(Triple(AIcons.enter, "Выйти", "#pf-logout"))
                    add(Triple(AIcons.trash, "Удалить аккаунт", "#pf-delete"))
                }
                Group {
                    acts.forEachIndexed { i, (icon, s, sel) ->
                        GroupRow(icon, s, last = i == acts.lastIndex, danger = sel == "#pf-delete") { menu = false; Engine.send("profileTap", sel) }
                    }
                }
                Spacer(Modifier.height(20.dp))
            }
            SheetHost(avatarMenu, { avatarMenu = false }) {
                Txt("Фото профиля", A.headline, p.text, Modifier.align(Alignment.CenterHorizontally).padding(bottom = 10.dp))
                Group {
                    GroupRow(AIcons.user, if (data?.avatar.isNullOrEmpty()) "Выбрать фото" else "Выбрать другое фото", last = data?.avatar.isNullOrEmpty()) {
                        avatarMenu = false
                        pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                    }
                    if (!data?.avatar.isNullOrEmpty()) GroupRow(AIcons.trash, "Убрать фото", last = true, danger = true) { avatarMenu = false; Engine.send("avatarSet", "") }
                }
                Spacer(Modifier.height(20.dp))
            }
            crop?.let { b -> AvatarCrop(b, onCancel = { crop = null }) { url -> crop = null; Engine.send("avatarSet", url) } }
        }
    }
}

// ---------- шапка ----------

@Composable
private fun Header(d: Prof, onAvatar: () -> Unit) {
    val p = LocalPal.current
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(Modifier.height(6.dp))
        Box(Modifier.size(108.dp).press(scale = 0.94f, onClick = onAvatar), contentAlignment = Alignment.Center) {
            // кольцо как у историй: медленно вращается
            val tr = rememberInfiniteTransition(label = "ring")
            val rot by tr.animateFloat(0f, 360f, infiniteRepeatable(tween(9000, easing = LinearEasing)), label = "rot")
            Canvas(Modifier.fillMaxSize()) {
                rotate(rot) {
                    drawCircle(
                        Brush.sweepGradient(listOf(p.accent, Color(0xFFFF8A3D), Color(0xFFFFC23D), Color(0xFFB04BFF), p.accent)),
                        radius = size.minDimension / 2 - 1.5.dp.toPx(), style = Stroke(3.dp.toPx()),
                    )
                }
            }
            Avatar(d.avatar, d.name, Modifier.size(96.dp).border(3.dp, p.bg, CircleShape))
            Box(
                Modifier.align(Alignment.BottomEnd).offset((-4).dp, (-4).dp).size(28.dp).clip(CircleShape).background(p.bg).padding(3.dp).clip(CircleShape).background(p.accent),
                contentAlignment = Alignment.Center,
            ) { Ico(G.plus, Color.White, 14.dp) }
        }
        Spacer(Modifier.height(12.dp))
        Txt(d.name, A.title3, p.text, maxLines = 1)
        Spacer(Modifier.height(2.dp))
        Txt(listOf(if (d.login.isNotEmpty()) "@${d.login}" else "", d.host).filter { it.isNotEmpty() }.joinToString(" · "), A.footnote, p.text2, maxLines = 1)
        Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(7.dp).clip(CircleShape).background(if (d.error.isNotEmpty()) p.danger else if (d.syncing) p.text2 else Color(0xFF30D158)))
            Spacer(Modifier.width(6.dp))
            Txt(d.sync + if (d.error.isNotEmpty()) ": ${d.error}" else "", A.caption, if (d.error.isNotEmpty()) p.danger else p.text2, maxLines = 1)
        }
        // цифры, как «подписки · подписчики · лайки»
        Row(Modifier.fillMaxWidth().padding(top = 18.dp, bottom = 16.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
            Num(d.friends.toString(), "друзей") { Engine.send("friends") }
            Num(short(d.month.totalText), "за ${d.month.label.substringBefore(' ')}")
            Num(d.month.plays.toString(), plays(d.month.plays))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Pill("Изменить имя", Modifier.weight(1f), small = false) { Engine.send("profileTap", "#pf-rename") }
            Pill(if (d.syncing) "Синхронизация…" else "Синхронизировать", Modifier.weight(1f), enabled = !d.syncing) { Engine.send("profileTap", "#pf-sync") }
            Box(Modifier.size(46.dp).clip(RoundedCornerShape(12.dp)).background(p.soft).press(scale = 0.92f) { Engine.send("friends") }, contentAlignment = Alignment.Center) {
                Ico(AIcons.friends, p.text, 20.dp)
            }
        }
        if (d.keys != "ok") {
            Row(Modifier.padding(top = 12.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(p.danger.copy(alpha = 0.14f)).padding(12.dp)) {
                Txt(
                    if (d.keys == "nokey") "Чтобы ключи сервисов синхронизировались, выйди и войди снова — один раз: они шифруются твоим паролем."
                    else "Ключи сервисов на сервере зашифрованы другим паролем — его меняли на другом устройстве. Выйди и войди с новым паролем.",
                    A.footnote, p.text,
                )
            }
        }
        Spacer(Modifier.height(14.dp))
    }
}

private fun short(s: String) = s.replace(" часов", " ч").replace(" часа", " ч").replace(" час", " ч").replace(" минут", " мин").replace(" минуты", " мин").replace(" минута", " мин")
private fun plays(n: Int) = when { n % 10 == 1 && n % 100 != 11 -> "прослушивание"; n % 10 in 2..4 && n % 100 !in 12..14 -> "прослушивания"; else -> "прослушиваний" }

@Composable
private fun Num(v: String, label: String, onClick: (() -> Unit)? = null) {
    val p = LocalPal.current
    Column(
        Modifier.width(104.dp).then(if (onClick != null) Modifier.press(scale = 0.94f, onClick = onClick) else Modifier),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Txt(v, A.title3, p.text, maxLines = 1)
        Txt(label, A.footnote, p.text2, maxLines = 1)
    }
}

// ---------- вкладки значками ----------

private val gridIcon by lazy {
    androidx.compose.ui.graphics.vector.ImageVector.Builder("grid", 24.dp, 24.dp, 24f, 24f).apply {
        for (r in 0..2) for (c in 0..2) {
            val x = 3.5f + c * 6f; val y = 3.5f + r * 6f
            addPath(androidx.compose.ui.graphics.vector.addPathNodes("M$x $y h4.5 v4.5 h-4.5 z"), fill = androidx.compose.ui.graphics.SolidColor(Color.Black))
        }
    }.build()
}

@Composable
private fun Tabs(tab: PTab, onPick: (PTab) -> Unit) {
    val p = LocalPal.current
    val x by animateFloatAsState(tab.ordinal.toFloat(), spring(dampingRatio = 0.8f, stiffness = 500f), label = "ptab")
    val icons: List<ImageVector?> = listOf(gridIcon, AIcons.stats, AIcons.plug, AIcons.device)
    BoxWithConstraints(Modifier.fillMaxWidth().background(p.bg).hairline()) {
        val cell = maxWidth / 4
        Row(Modifier.fillMaxWidth().height(46.dp)) {
            PTab.entries.forEachIndexed { i, t ->
                val on = t == tab
                Box(Modifier.weight(1f).fillMaxHeight().tap { onPick(t) }, contentAlignment = Alignment.Center) {
                    Ico(icons[i], if (on) p.text else p.text3, 22.dp)
                }
            }
        }
        Box(Modifier.align(Alignment.BottomStart).offset(x = cell * x + cell * 0.2f).width(cell * 0.6f).height(2.dp).background(p.text))
    }
}

@Composable
private fun MonthNav(m: Month, onMonth: (String) -> Unit) {
    val p = LocalPal.current
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        IconBtn(G.chevronL, tint = p.accent, size = 38.dp, iconSize = 16.dp, enabled = m.canPrev) { onMonth(shiftMonth(m.key, -1)) }
        Txt(m.label.replaceFirstChar { it.uppercase() }, A.headline.copy(textAlign = TextAlign.Center), p.text, Modifier.weight(1f), maxLines = 1)
        IconBtn(G.chevronR, tint = p.accent, size = 38.dp, iconSize = 16.dp, enabled = m.canNext) { onMonth(shiftMonth(m.key, 1)) }
    }
}

private fun shiftMonth(mk: String, delta: Int): String {
    val (y, m) = mk.split("-").map { it.toIntOrNull() ?: 1 }
    val t = y * 12 + (m - 1) + delta
    return "%04d-%02d".format(t / 12, t % 12 + 1)
}

// ---------- «Любимое»: сетка обложек со счётчиком, как ролики в профиле TikTok ----------

private fun androidx.compose.foundation.lazy.LazyListScope.loved(d: Prof, onMonth: (String) -> Unit) {
    val m = d.month
    item(key = "lovedNav") { MonthNav(m, onMonth) }
    if (m.tracks.isEmpty()) item(key = "lovedEmpty") { EmptyNote("Пока пусто", "Слушай музыку — здесь соберутся треки, которые ты крутишь чаще всего.") }
    items(m.tracks.indices.chunked(3), key = { "g${m.key}:${it.first()}" }) { row ->
        Row(Modifier.fillMaxWidth().padding(bottom = 2.dp).animateItem(), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            for (i in row) {
                val t = m.tracks[i]
                Box(Modifier.weight(1f).aspectRatio(0.78f).press(scale = 0.97f) { Engine.send("statsPlay", m.key, i) }) {
                    Cover(t, Modifier.fillMaxSize(), 360, RectangleShape)
                    Box(Modifier.fillMaxWidth().height(56.dp).align(Alignment.BottomCenter).background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.7f)))))
                    Row(Modifier.align(Alignment.BottomStart).padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Ico(G.play, Color.White, 12.dp)
                        Spacer(Modifier.width(3.dp))
                        Txt(m.plays30.getOrElse(i) { 0 }.toString(), A.footnoteM, Color.White)
                    }
                    if (i < 3) Box(Modifier.align(Alignment.TopStart).padding(6.dp).clip(RoundedCornerShape(4.dp)).background(LocalPal.current.accent).padding(horizontal = 5.dp, vertical = 1.dp)) {
                        Txt("#${i + 1}", A.tab, Color.White)
                    }
                }
            }
            repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
        }
    }
}

// ---------- статистика ----------

private fun androidx.compose.foundation.lazy.LazyListScope.statsTab(d: Prof, onMonth: (String) -> Unit) {
    val m = d.month
    item(key = "stNav") { MonthNav(m, onMonth) }
    item(key = "stHero") {
        val p = LocalPal.current
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).animateItem()) {
            Txt(m.totalText.ifEmpty { "0 мин" }, A.large, p.text)
            Txt("музыки за ${if (m.current) "этот месяц" else m.label.substringBefore(' ')}", A.subhead, p.text2)
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                StatCard("в среднем в день", m.avgText, Modifier.weight(1f))
                StatCard("дней с музыкой", m.activeDays.toString(), Modifier.weight(1f))
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                StatCard(plays(m.plays), m.plays.toString(), Modifier.weight(1f))
                StatCard("за всё время", m.allTimeText, Modifier.weight(1f))
            }
            Spacer(Modifier.height(18.dp))
            DaysChart(m)
        }
    }
    if (m.artists.isNotEmpty()) {
        item(key = "stArtH") { Txt("Артисты месяца", A.title2, LocalPal.current.text, Modifier.padding(start = 16.dp, top = 26.dp, bottom = 8.dp)) }
        val max = m.artists.first().sec.coerceAtLeast(1)
        itemsIndexed(m.artists, key = { i, a -> "a${m.key}:$i:${a.name}" }) { i, a ->
            val p = LocalPal.current
            Row(Modifier.fillMaxWidth().animateItem().press(scale = 0.98f) { Engine.send("artist", a.name) }.padding(horizontal = 16.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                Txt("${i + 1}", A.footnoteM, p.text2, Modifier.width(22.dp))
                Img(a.cover, Modifier.size(44.dp), 140, CircleShape) { Txt(a.name.take(1).uppercase(), A.headline, p.text2) }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Txt(a.name, A.callout, p.text, Modifier.weight(1f), maxLines = 1)
                        Txt(a.text, A.footnote, p.text2)
                    }
                    Spacer(Modifier.height(5.dp))
                    val k by animateFloatAsState(a.sec.toFloat() / max, tween(700), label = "abar")
                    Box(Modifier.fillMaxWidth().height(4.dp).clip(CircleShape).background(p.soft)) {
                        Box(Modifier.fillMaxWidth(k.coerceIn(0.02f, 1f)).fillMaxHeight().background(p.accent))
                    }
                }
            }
        }
    }
}

@Composable
private fun StatCard(label: String, value: String, modifier: Modifier) {
    val p = LocalPal.current
    Column(modifier.clip(RoundedCornerShape(12.dp)).background(p.surface).padding(14.dp)) {
        Txt(value.ifEmpty { "0" }, A.title3, p.text, maxLines = 1)
        Txt(label, A.footnote, p.text2, maxLines = 1)
    }
}

/** Минуты музыки по дням: столбики растут при открытии. */
@Composable
private fun DaysChart(m: Month) {
    val p = LocalPal.current
    var started by remember(m.key) { mutableStateOf(false) }
    LaunchedEffect(m.key) { started = true }
    val k by animateFloatAsState(if (started) 1f else 0f, tween(650), label = "chart")
    val max = (m.days.maxOrNull() ?: 0).coerceAtLeast(1)
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(p.surface).padding(14.dp)) {
        Txt("Минуты по дням", A.footnoteM, p.text2)
        Spacer(Modifier.height(10.dp))
        Canvas(Modifier.fillMaxWidth().height(120.dp)) {
            val n = m.days.size.coerceAtLeast(1)
            val slot = size.width / n
            val bw = (slot - 2.dp.toPx()).coerceAtLeast(2f)
            m.days.forEachIndexed { i, v ->
                val h = (v.toFloat() / max) * size.height * k
                val c = if (i + 1 == m.today) p.accent else p.accent.copy(alpha = 0.55f)
                if (v > 0) drawRoundRect(c, Offset(i * slot, size.height - h.coerceAtLeast(3f)), Size(bw, h.coerceAtLeast(3f)), androidx.compose.ui.geometry.CornerRadius(bw / 2))
                else drawRoundRect(p.soft, Offset(i * slot, size.height - 3f), Size(bw, 3f))
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
            Txt("1", A.caption, p.text3)
            Spacer(Modifier.weight(1f))
            Txt("${m.days.size}", A.caption, p.text3)
        }
    }
}

// ---------- подключено ----------

private fun brandColor(s: String, p: Pal): Color = parseCss(s) ?: when { s.contains("voice") -> p.voice; else -> p.accent }

private fun androidx.compose.foundation.lazy.LazyListScope.connTab(d: Prof) {
    item(key = "connH") {
        val p = LocalPal.current
        val n = d.conns.count { it.on }
        Txt("Подключено $n из ${d.conns.size}", A.footnote, p.text2, Modifier.padding(start = 20.dp, top = 16.dp, bottom = 8.dp))
    }
    item(key = "connList") {
        val p = LocalPal.current
        Group(Modifier.animateItem()) {
            d.conns.forEachIndexed { i, c ->
                Row(Modifier.fillMaxWidth().cell { Engine.send("profileTap", "[data-conn=\"${c.id}\"]") }.padding(start = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    val bc = brandColor(c.brand, p)
                    Box(Modifier.size(32.dp).clip(RoundedCornerShape(8.dp)).background(if (c.on) bc else p.soft), contentAlignment = Alignment.Center) {
                        Txt(c.name.take(1), A.headline, if (c.on) Color.White else p.text2)
                    }
                    Spacer(Modifier.width(12.dp))
                    Row(Modifier.weight(1f).hairline(i < d.conns.lastIndex).padding(end = 14.dp, top = 11.dp, bottom = 11.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Txt(c.name, A.callout, p.text, maxLines = 1)
                            Txt(c.detail, A.footnote, p.text2, maxLines = 2)
                        }
                        Txt(if (c.on) "Настроить" else "Подключить", A.footnoteM, p.accent)
                    }
                }
            }
        }
    }
}

// ---------- устройства и аккаунт ----------

private fun androidx.compose.foundation.lazy.LazyListScope.devicesTab(d: Prof) {
    item(key = "devH") { Txt("УСТРОЙСТВА", A.footnote, LocalPal.current.text2, Modifier.padding(start = 20.dp, top = 16.dp, bottom = 8.dp)) }
    item(key = "devList") {
        val p = LocalPal.current
        val list = d.devices
        when {
            d.devicesError.isNotEmpty() -> Txt("Список не загрузился: ${d.devicesError}", A.footnote, p.danger, Modifier.padding(horizontal = 20.dp))
            list == null -> Box(Modifier.fillMaxWidth().padding(20.dp), contentAlignment = Alignment.Center) { Spinner() }
            else -> Group(Modifier.animateItem()) {
                list.forEachIndexed { i, dv ->
                    Row(Modifier.fillMaxWidth().padding(start = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Ico(AIcons.device, if (dv.current) p.accent else p.text2, 22.dp)
                        Spacer(Modifier.width(12.dp))
                        Row(Modifier.weight(1f).hairline(i < list.lastIndex).padding(end = 14.dp, top = 11.dp, bottom = 11.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Txt(dv.name, A.callout, p.text, maxLines = 1)
                                Txt(dv.ago, A.footnote, p.text2, maxLines = 1)
                            }
                            if (dv.current) Tag("здесь", p.accent)
                        }
                    }
                }
            }
        }
        if (list != null && list.count { !it.current } > 0) {
            Pill("Выйти на других устройствах", Modifier.padding(horizontal = 16.dp, vertical = 12.dp).fillMaxWidth(), tinted = true) { Engine.send("profileTap", "#pf-logout-all") }
        }
    }
    item(key = "accH") { Txt("АККАУНТ", A.footnote, LocalPal.current.text2, Modifier.padding(start = 20.dp, top = 22.dp, bottom = 8.dp)) }
    item(key = "accList") {
        Group(Modifier.animateItem()) {
            GroupRow(AIcons.keys, "Сменить пароль") { Engine.send("profileTap", "#pf-password") }
            GroupRow(AIcons.enter, "Выйти") { Engine.send("profileTap", "#pf-logout") }
            GroupRow(AIcons.trash, "Удалить аккаунт", last = true, danger = true) { Engine.send("profileTap", "#pf-delete") }
        }
        Txt(
            "Альбомы, эквалайзер, бочка, статистика и ключи сервисов одинаковые на всех твоих устройствах. Ключи хранятся на сервере зашифрованными твоим паролем — сервер их не видит.",
            A.footnote, LocalPal.current.text2, Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
        )
    }
}

// ---------- общие кусочки ----------

@Composable
private fun EmptyNote(title: String, text: String) {
    val p = LocalPal.current
    Column(Modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Txt(title, A.title3, p.text)
        Spacer(Modifier.height(6.dp))
        Txt(text, A.subhead.copy(textAlign = TextAlign.Center), p.text2)
    }
}

@Composable
private fun Group(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(LocalPal.current.surface)) { content() }
}

@Composable
private fun GroupRow(icon: ImageVector?, s: String, last: Boolean = false, danger: Boolean = false, onClick: () -> Unit) {
    val p = LocalPal.current
    Row(Modifier.fillMaxWidth().cell(onClick = onClick).padding(start = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        Ico(icon, if (danger) p.danger else p.accent, 21.dp)
        Spacer(Modifier.width(12.dp))
        Row(Modifier.weight(1f).hairline(!last).padding(end = 14.dp, top = 13.dp, bottom = 13.dp), verticalAlignment = Alignment.CenterVertically) {
            Txt(s, A.body, if (danger) p.danger else p.text, Modifier.weight(1f))
            if (!danger) Ico(G.chevronR, p.text3, 14.dp)
        }
    }
}

// ---------- аватар: выбор и кадрирование ----------

private fun loadBitmap(ctx: Context, uri: Uri, max: Int = 2048): Bitmap? = try {
    if (Build.VERSION.SDK_INT >= 28) {
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(ctx.contentResolver, uri)) { dec, info, _ ->
            val s = maxOf(info.size.width, info.size.height)
            if (s > max) dec.setTargetSampleSize(maxOf(1, s / max))
            dec.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
    } else {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, o) }
        var sample = 1
        while (maxOf(o.outWidth, o.outHeight) / sample > max) sample *= 2
        ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
    }
} catch (e: Exception) { null }

/** Кадр: фото двигается и приближается пальцами, что в кружке — то и будет на аватарке (256×256 JPEG). */
@Composable
private fun AvatarCrop(b: Bitmap, onCancel: () -> Unit, onDone: (String) -> Unit) {
    val p = LocalPal.current
    val img = remember(b) { b.asImageBitmap() }
    var z by remember(b) { mutableFloatStateOf(1f) }
    var x by remember(b) { mutableFloatStateOf(0f) }
    var y by remember(b) { mutableFloatStateOf(0f) }
    var view by remember { mutableStateOf(IntSize.Zero) }
    val w = b.width.toFloat(); val h = b.height.toFloat()
    val zMax = (min(w, h) / 100f).coerceIn(2f, 6f)
    fun dia() = min(view.width, view.height) * 0.84f
    fun scale() = dia() / min(w, h) * z
    fun clampXY() {
        val s = scale()
        val mx = ((w * s - dia()) / 2).coerceAtLeast(0f); val my = ((h * s - dia()) / 2).coerceAtLeast(0f)
        x = x.coerceIn(-mx, mx); y = y.coerceIn(-my, my)
    }
    Box(Modifier.fillMaxSize().background(Color.Black).absorb()) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            Box(Modifier.fillMaxWidth().height(48.dp)) {
                Txt("Отмена", A.body, Color.White, Modifier.align(Alignment.CenterStart).padding(start = 16.dp).press(onClick = onCancel))
                Txt("Фото профиля", A.headline, Color.White, Modifier.align(Alignment.Center))
                Txt("Готово", A.headline, p.accent, Modifier.align(Alignment.CenterEnd).padding(end = 16.dp).press {
                    val s = scale(); val d = dia(); val side = d / s
                    val left = w / 2 - (d / 2 + x) / s; val top = h / 2 - (d / 2 + y) / s
                    val out = Bitmap.createBitmap(256, 256, Bitmap.Config.ARGB_8888)
                    val c = android.graphics.Canvas(out)
                    c.drawColor(android.graphics.Color.WHITE)
                    c.drawBitmap(
                        b, android.graphics.Rect(left.roundToInt(), top.roundToInt(), (left + side).roundToInt(), (top + side).roundToInt()),
                        android.graphics.Rect(0, 0, 256, 256), android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG),
                    )
                    val bytes = ByteArrayOutputStream().also { out.compress(Bitmap.CompressFormat.JPEG, 88, it) }.toByteArray()
                    onDone("data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP))
                })
            }
            Box(
                Modifier.fillMaxWidth().weight(1f)
                    .pointerInput(b) {
                        view = size
                        detectTransformGestures { _, pan, zoom, _ ->
                            z = (z * zoom).coerceIn(1f, zMax)
                            x += pan.x; y += pan.y
                            clampXY()
                        }
                    },
            ) {
                Canvas(Modifier.fillMaxSize()) {
                    if (view != IntSize(size.width.roundToInt(), size.height.roundToInt())) view = IntSize(size.width.roundToInt(), size.height.roundToInt())
                    val s = scale()
                    val dw = w * s; val dh = h * s
                    drawImage(
                        img, dstOffset = IntOffset((size.width / 2 + x - dw / 2).roundToInt(), (size.height / 2 + y - dh / 2).roundToInt()),
                        dstSize = IntSize(dw.roundToInt(), dh.roundToInt()),
                    )
                    val d = dia()
                    val hole = Path().apply {
                        fillType = PathFillType.EvenOdd
                        addRect(androidx.compose.ui.geometry.Rect(Offset.Zero, size))
                        addOval(androidx.compose.ui.geometry.Rect(center, d / 2))
                    }
                    drawPath(hole, Color.Black.copy(alpha = 0.6f))
                    drawCircle(Color.White.copy(alpha = 0.8f), d / 2, center, style = Stroke(1.5.dp.toPx()))
                }
            }
            Txt("Двигай и приближай двумя пальцами", A.footnote, Color.White.copy(alpha = 0.6f), Modifier.align(Alignment.CenterHorizontally).padding(16.dp))
        }
    }
}
