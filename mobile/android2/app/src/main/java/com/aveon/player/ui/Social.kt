package com.aveon.player.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
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
import androidx.compose.foundation.gestures.detectTapGestures
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aveon.player.Engine
import com.aveon.player.Panel
import com.aveon.player.Track
import com.aveon.player.objects
import com.aveon.player.str
import com.aveon.player.strings
import kotlinx.coroutines.launch
import org.json.JSONObject

// Чат и профиль друга. Список друзей — «зеркало» панели движка, а когда в нём открыт чат
// или профиль (friends.js: Chat.id / FP.id), рисуем свои экраны: чат как Direct в Instagram,
// профиль — как свой (Profile.kt). Данные — renderer/native.js → friendsView.

private class FNow(val track: Track, val playing: Boolean, val live: Boolean, val ago: String, val pos: Double)
private class Friend(val id: Int, val name: String, val login: String, val avatar: String, val inRoom: Boolean, val unread: Int, val since: String, val now: FNow?)
private class React(val e: String, val n: Int, val mine: Boolean)
private class MTrack(val title: String, val artist: String, val cover: String)
private class MAlbum(val title: String, val cover: String, val count: Int)
private class Msg(
    val id: String, val mine: Boolean, val text: String, val edited: Boolean, val pending: Boolean, val my: String, val time: String,
    val track: MTrack?, val album: MAlbum?, val reactions: List<React>,
)

private fun friendOf(o: JSONObject?): Friend {
    val f = o ?: JSONObject()
    val n = f.optJSONObject("now")
    return Friend(
        f.optInt("id"), f.str("name"), f.str("login"), f.str("avatar"), f.optBoolean("inRoom"), f.optInt("unread"), f.str("since"),
        n?.let { x -> Track.of(x.optJSONObject("track"))?.let { FNow(it, x.optBoolean("playing"), x.optBoolean("live"), x.str("ago"), x.optDouble("pos", 0.0)) } },
    )
}

private fun msgOf(o: JSONObject) = Msg(
    o.str("id"), o.optBoolean("mine"), o.str("text"), o.optBoolean("edited"), o.optBoolean("pending"), o.str("my"), o.str("time"),
    o.optJSONObject("track")?.let { MTrack(it.str("title"), it.str("artist"), it.str("cover")) },
    o.optJSONObject("album")?.let { MAlbum(it.str("title"), it.str("cover"), it.optInt("count")) },
    o.optJSONArray("reactions").objects().map { React(it.str("e"), it.optInt("n"), it.optBoolean("mine")) },
)

/** Панель «Друзья»: список — зеркалом, чат и профиль друга — своими экранами. */
@Composable
fun FriendsHost(panel: Panel) {
    var view by remember { mutableStateOf<JSONObject?>(null) }
    LaunchedEffect(panel) { view = Engine.obj("friendsView") }
    when (view?.optString("mode")) {
        "chat" -> key("chat" + view!!.optJSONObject("friend")?.optInt("id")) { ChatScreen(view!!) }
        "profile" -> key("fp" + view!!.optJSONObject("friend")?.optInt("id")) { FriendProfile(view!!) }
        else -> PanelHost(panel, native = false)
    }
}

@Composable
private fun SlideIn(content: @Composable () -> Unit) {
    var shown by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { shown = true }
    AnimatedVisibility(
        shown,
        enter = slideInHorizontally(spring(dampingRatio = 0.92f, stiffness = 340f)) { it },
        exit = slideOutHorizontally(tween(240)) { it } + fadeOut(tween(240)),
    ) { content() }
}

/** Аватар с кольцом: цветное вращается, если человек сейчас слушает музыку. */
@Composable
fun RingAvatar(url: String, name: String, size: androidx.compose.ui.unit.Dp, live: Boolean, ring: Boolean = true) {
    val p = LocalPal.current
    Box(Modifier.size(size), contentAlignment = Alignment.Center) {
        if (ring) {
            val tr = rememberInfiniteTransition(label = "ring")
            val rot by tr.animateFloat(0f, 360f, infiniteRepeatable(tween(if (live) 4000 else 12000, easing = LinearEasing)), label = "rot")
            Canvas(Modifier.fillMaxSize().rotate(rot)) {
                val w = (size.toPx() * 0.03f).coerceAtLeast(2f)
                drawCircle(
                    if (live) Brush.sweepGradient(listOf(Color(0xFF30D158), Color(0xFF64D2FF), Color(0xFF30D158)))
                    else Brush.sweepGradient(listOf(p.accent, Color(0xFFFF8A3D), Color(0xFFFFC23D), Color(0xFFB04BFF), p.accent)),
                    radius = this.size.minDimension / 2 - w / 2, style = Stroke(w),
                )
            }
        }
        Avatar(url, name, Modifier.size(size * 0.88f).border((size.value * 0.03f).dp, p.bg, CircleShape))
    }
}

// ================= чат =================

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ChatScreen(v: JSONObject) {
    val p = LocalPal.current
    val f = friendOf(v.optJSONObject("friend"))
    val msgs = v.optJSONArray("messages").objects().map(::msgOf)
    val loading = v.optBoolean("loading")
    val error = v.str("error")
    val more = v.optBoolean("more")
    val nowTitle = v.str("nowTitle")
    val reactions = v.optJSONArray("reactions").strings().ifEmpty { listOf("❤️", "🔥", "😂", "😍", "👍", "👏", "😢", "💀") }
    var text by remember { mutableStateOf("") }
    var editing by remember { mutableStateOf<Msg?>(null) }
    var menuFor by remember { mutableStateOf<Msg?>(null) }
    var hearts by remember { mutableStateOf<Set<String>>(emptySet()) }
    val state = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val clip = LocalClipboardManager.current
    val haptic = LocalHapticFeedback.current
    BackHandler { if (editing != null) { editing = null; text = "" } else Engine.send("chatBack") }

    // новое сообщение внизу — докручиваем, если и так были внизу
    val newest = msgs.lastOrNull()?.id
    LaunchedEffect(newest) { if (state.firstVisibleItemIndex <= 2) state.animateScrollToItem(0) }
    // долистали до самого старого — подгружаем ещё
    LaunchedEffect(state, more) {
        snapshotFlow { state.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }.collect { last ->
            if (more && msgs.isNotEmpty() && last >= msgs.size - 2) Engine.send("chatOlder")
        }
    }

    SlideIn {
        Box(Modifier.fillMaxSize().background(p.bg).absorb()) {
            Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
                // шапка: назад, аватар, имя и что слушает
                Row(Modifier.fillMaxWidth().height(56.dp).hairline().padding(end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconBtn(G.chevronL, tint = p.text, iconSize = 20.dp) { Engine.send("chatBack") }
                    Row(
                        Modifier.weight(1f).press(scale = 0.98f) { Engine.send("chatBack"); Engine.send("friendProfile", f.id) },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RingAvatar(f.avatar, f.name, 40.dp, f.now?.playing == true, ring = f.now?.playing == true)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Txt(f.name, A.headline, p.text, maxLines = 1)
                            val st = f.now?.let { n -> if (n.playing) "слушает: ${n.track.title}" else if (n.live) "на паузе" else "был ${n.ago}".trim() } ?: "@${f.login}"
                            Txt(st, A.caption, if (f.now?.playing == true) Color(0xFF30D158) else p.text2, maxLines = 1)
                        }
                    }
                    IconBtn(AIcons.together, tint = p.text, size = 40.dp) { Engine.send("chatBack"); Engine.send("friendProfile", f.id) }
                }
                // сообщения: новые снизу
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    LazyColumn(Modifier.fillMaxSize(), state = state, reverseLayout = true, contentPadding = PaddingValues(horizontal = 10.dp, vertical = 10.dp)) {
                        val rev = msgs.asReversed()
                        itemsIndexed(rev, key = { _, m -> m.id }) { i, m ->
                            // группа подряд от одного — скругления как в Direct, аватар у последнего
                            val newer = rev.getOrNull(i - 1)
                            val older = rev.getOrNull(i + 1)
                            val firstOfGroup = older?.mine != m.mine
                            val lastOfGroup = newer?.mine != m.mine
                            Bubble(
                                m, f, firstOfGroup, lastOfGroup, heart = m.id in hearts,
                                modifier = Modifier.animateItem(fadeInSpec = tween(220), placementSpec = spring(dampingRatio = 0.85f, stiffness = 500f)),
                                onDouble = {
                                    if (m.pending) return@Bubble
                                    if (m.mine) { if (m.album == null) { editing = m; text = m.text } }
                                    else {
                                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                        if (m.my != "❤️") { hearts = hearts + m.id; scope.launch { kotlinx.coroutines.delay(900); hearts = hearts - m.id } }
                                        Engine.send("chatReact", m.id, "❤️")
                                    }
                                },
                                onLong = { if (!m.pending) { haptic.performHapticFeedback(HapticFeedbackType.LongPress); menuFor = m } },
                            )
                        }
                        if (more && msgs.isNotEmpty()) item(key = "older") { Box(Modifier.fillMaxWidth().padding(10.dp), contentAlignment = Alignment.Center) { Spinner(size = 18.dp) } }
                    }
                    when {
                        msgs.isEmpty() && loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Spinner() }
                        msgs.isEmpty() -> Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                            RingAvatar(f.avatar, f.name, 96.dp, f.now?.playing == true)
                            Spacer(Modifier.height(12.dp))
                            Txt(f.name, A.title3, p.text)
                            Txt("@${f.login}", A.footnote, p.text2)
                            Spacer(Modifier.height(14.dp))
                            Txt(if (error.isNotEmpty()) error else "Напиши первым или отправь, что сейчас играет", A.subhead.copy(textAlign = TextAlign.Center), if (error.isNotEmpty()) p.danger else p.text2)
                        }
                    }
                }
                if (error.isNotEmpty() && msgs.isNotEmpty()) Txt(error, A.footnote, p.danger, Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
                // изменение сообщения — полоса над полем
                AnimatedVisibility(editing != null) {
                    Row(Modifier.fillMaxWidth().background(p.surface).padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Ico(AIcons.pencil, p.accent, 16.dp)
                        Spacer(Modifier.width(8.dp))
                        Column(Modifier.weight(1f).padding(vertical = 6.dp)) {
                            Txt("Изменение сообщения", A.footnoteM, p.accent)
                            Txt(editing?.text ?: "", A.footnote, p.text2, maxLines = 1)
                        }
                        IconBtn(AIcons.close, tint = p.text2, size = 40.dp, iconSize = 16.dp) { editing = null; text = "" }
                    }
                }
                Composer(text, { text = it }, editing != null, nowTitle, onAttach = { Engine.send("chatAttach") }) {
                    val t = text.trim()
                    val e = editing
                    if (e != null) { Engine.send("chatEdit", e.id, t); editing = null; text = "" }
                    else if (t.isNotEmpty()) { Engine.send("chatSend", t); text = "" }
                }
            }

            // долгое нажатие: реакции и действия
            SheetHost(menuFor != null, { menuFor = null }) {
                val m = menuFor
                if (m != null) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                        reactions.forEachIndexed { i, e ->
                            var on by remember { mutableStateOf(false) }
                            LaunchedEffect(Unit) { kotlinx.coroutines.delay(i * 30L); on = true }
                            val k by animateFloatAsState(if (on) 1f else 0.3f, spring(dampingRatio = 0.5f, stiffness = 500f), label = "re")
                            Box(
                                Modifier.size(42.dp).graphicsLayer { scaleX = k; scaleY = k }.clip(CircleShape)
                                    .background(if (e == m.my) p.soft else Color.Transparent).press(scale = 0.8f) { menuFor = null; Engine.send("chatReact", m.id, e) },
                                contentAlignment = Alignment.Center,
                            ) { Txt(e, A.title2.copy(fontSize = 24.sp), Color.White) }
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Column(Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(p.soft)) {
                        SheetRow(AIcons.copy, "Копировать", m.mine && m.album == null) {
                            menuFor = null
                            scope.launch {
                                val s = Engine.call("chatCopyText", m.id) as? String ?: m.text
                                if (s.isNotEmpty()) { clip.setText(AnnotatedString(s)); Engine.toast("Скопировано") }
                            }
                        }
                        if (m.mine && m.album == null) SheetRow(AIcons.pencil, "Изменить", false) { menuFor = null; editing = m; text = m.text }
                    }
                    Txt(m.time + if (m.edited) " · изменено" else "", A.footnote, p.text2, Modifier.align(Alignment.CenterHorizontally).padding(top = 12.dp, bottom = 16.dp))
                }
            }
        }
    }
}

@Composable
private fun SheetRow(icon: androidx.compose.ui.graphics.vector.ImageVector?, s: String, divider: Boolean, onClick: () -> Unit) {
    val p = LocalPal.current
    Row(Modifier.fillMaxWidth().cell(onClick = onClick).padding(start = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.weight(1f).hairline(divider).padding(end = 16.dp, top = 13.dp, bottom = 13.dp), verticalAlignment = Alignment.CenterVertically) {
            Txt(s, A.body, p.text, Modifier.weight(1f))
            Ico(icon, p.text, 19.dp)
        }
    }
}

@Composable
private fun Bubble(
    m: Msg, f: Friend, first: Boolean, last: Boolean, heart: Boolean, modifier: Modifier,
    onDouble: () -> Unit, onLong: () -> Unit,
) {
    val p = LocalPal.current
    val big = 20.dp; val small = 5.dp
    val shape = if (m.mine) RoundedCornerShape(big, if (first) big else small, if (last) big else small, big)
    else RoundedCornerShape(if (first) big else small, big, big, if (last) big else small)
    val onlyEmoji = m.track == null && m.album == null && m.text.isNotEmpty() && m.text.length <= 8 && m.text.none { it.isLetterOrDigit() }
    Row(
        modifier.fillMaxWidth().padding(top = if (first) 8.dp else 2.dp).graphicsLayer { alpha = if (m.pending) 0.5f else 1f },
        horizontalArrangement = if (m.mine) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.Bottom,
    ) {
        if (!m.mine) {
            Box(Modifier.size(28.dp)) { if (last) Avatar(f.avatar, f.name, Modifier.fillMaxSize()) }
            Spacer(Modifier.width(8.dp))
        }
        Column(horizontalAlignment = if (m.mine) Alignment.End else Alignment.Start) {
            Box {
                Column(
                    Modifier
                        .widthIn(max = 280.dp)
                        .clip(shape)
                        .then(
                            if (onlyEmoji) Modifier
                            else if (m.mine) Modifier.background(Brush.linearGradient(listOf(p.accent, Color(0xFFD7265E))))
                            else Modifier.background(Color(0xFF262628)),
                        )
                        .pointerInput(m.id) { detectTapGestures(onDoubleTap = { onDouble() }, onLongPress = { onLong() }) },
                ) {
                    m.track?.let { t ->
                        Row(
                            Modifier.padding(6.dp).clip(RoundedCornerShape(14.dp)).background(Color.Black.copy(alpha = 0.22f)).press(scale = 0.97f) { Engine.send("chatPlay", m.id) }.padding(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Img(t.cover, Modifier.size(46.dp), 140, RoundedCornerShape(8.dp)) { Txt("♪", A.headline, Color.White) }
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.widthIn(max = 160.dp)) {
                                Txt(t.title, A.subheadM, Color.White, maxLines = 1)
                                Txt(t.artist, A.footnote, Color.White.copy(alpha = 0.7f), maxLines = 1)
                            }
                            Spacer(Modifier.width(10.dp))
                            Box(Modifier.size(30.dp).clip(CircleShape).background(Color.White), contentAlignment = Alignment.Center) { Ico(G.play, Color.Black, 13.dp) }
                        }
                    }
                    m.album?.let { a ->
                        Row(
                            Modifier.padding(6.dp).clip(RoundedCornerShape(14.dp)).background(Color.Black.copy(alpha = 0.22f)).press(scale = 0.97f) { Engine.send("chatAlbum", m.id) }.padding(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Img(a.cover, Modifier.size(46.dp), 140, RoundedCornerShape(8.dp)) { Ico(AIcons.list, Color.White, 20.dp) }
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.widthIn(max = 150.dp)) {
                                Txt(a.title, A.subheadM, Color.White, maxLines = 1)
                                Txt("альбом · ${a.count} ${trackWord(a.count)}", A.footnote, Color.White.copy(alpha = 0.7f), maxLines = 1)
                            }
                            Spacer(Modifier.width(8.dp))
                            Txt("добавить", A.footnoteM, Color.White)
                        }
                    }
                    if (m.text.isNotEmpty()) Txt(
                        m.text, if (onlyEmoji) A.large.copy(fontSize = 40.sp, lineHeight = 46.sp) else A.callout, Color.White,
                        Modifier.padding(horizontal = if (onlyEmoji) 2.dp else 13.dp, vertical = if (onlyEmoji) 0.dp else 8.dp),
                    )
                }
                // двойной тап — большое сердце на миг, как в Instagram
                if (heart) HeartPop(Modifier.align(Alignment.Center))
            }
            if (m.reactions.isNotEmpty() || m.edited) {
                Row(Modifier.offset(y = (-4).dp).padding(horizontal = 6.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    for (r in m.reactions) {
                        Row(
                            Modifier.clip(CircleShape).background(if (r.mine) p.soft else p.surface).border(1.5.dp, p.bg, CircleShape)
                                .press(scale = 0.85f) { Engine.send("chatReact", m.id, r.e) }.padding(horizontal = 6.dp, vertical = 2.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Txt(r.e, A.footnote, Color.White)
                            if (r.n > 1) Txt(" ${r.n}", A.caption, p.text2)
                        }
                    }
                    if (m.edited) Txt("изменено", A.caption, p.text3)
                }
            }
        }
    }
}

private fun trackWord(n: Int) = when { n % 10 == 1 && n % 100 != 11 -> "трек"; n % 10 in 2..4 && n % 100 !in 12..14 -> "трека"; else -> "треков" }

@Composable
private fun HeartPop(modifier: Modifier) {
    val k = remember { Animatable(0f) }
    LaunchedEffect(Unit) { k.animateTo(1f, spring(dampingRatio = 0.45f, stiffness = 380f)) }
    val fade = remember { Animatable(1f) }
    LaunchedEffect(Unit) { kotlinx.coroutines.delay(500); fade.animateTo(0f, tween(300)) }
    Txt("❤️", A.large.copy(fontSize = 54.sp), Color.White, modifier.graphicsLayer { scaleX = k.value; scaleY = k.value; alpha = fade.value })
}

/** Поле сообщения: кружок «отправить, что играет», поле, стрелка отправки появляется, когда есть текст. */
@Composable
private fun Composer(text: String, onText: (String) -> Unit, editing: Boolean, nowTitle: String, onAttach: () -> Unit, onSend: () -> Unit) {
    val p = LocalPal.current
    Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.Bottom) {
        Row(
            Modifier.weight(1f).clip(RoundedCornerShape(24.dp)).background(p.surface).padding(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.size(38.dp).graphicsLayer { alpha = if (nowTitle.isEmpty() || editing) 0.35f else 1f }
                    .press(enabled = nowTitle.isNotEmpty() && !editing, scale = 0.88f, onClick = onAttach).clip(CircleShape)
                    .background(Brush.linearGradient(listOf(p.accent, Color(0xFFD7265E)))),
                contentAlignment = Alignment.Center,
            ) { Txt("♪", A.headline, Color.White) }
            Spacer(Modifier.width(8.dp))
            BasicTextField(
                text, onText,
                Modifier.weight(1f).padding(vertical = 9.dp),
                textStyle = A.callout.copy(color = p.text),
                cursorBrush = SolidColor(p.accent),
                maxLines = 5,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { onSend() }),
                decorationBox = { inner ->
                    Box {
                        if (text.isEmpty()) Txt(if (nowTitle.isNotEmpty() && !editing) "Сообщение… или ♪ «$nowTitle»" else "Сообщение…", A.callout, p.text2, maxLines = 1)
                        inner()
                    }
                },
            )
            val ready = text.isNotBlank()
            val k by animateFloatAsState(if (ready) 1f else 0f, spring(dampingRatio = 0.6f, stiffness = 600f), label = "send")
            if (k > 0.01f) Box(
                Modifier.padding(start = 6.dp).size(38.dp).graphicsLayer { scaleX = k; scaleY = k; alpha = k.coerceIn(0f, 1f) }
                    .press(scale = 0.85f, onClick = onSend).clip(CircleShape).background(p.accent),
                contentAlignment = Alignment.Center,
            ) { Ico(if (editing) AIcons.check else G.chevronL, Color.White, 17.dp, Modifier.graphicsLayer { rotationZ = if (editing) 0f else 90f }) }
        }
    }
}

// ================= профиль друга =================

@Composable
private fun FriendProfile(v: JSONObject) {
    val p = LocalPal.current
    val f = friendOf(v.optJSONObject("friend"))
    val st = v.optJSONObject("stats")
    val loading = v.optBoolean("loading")
    val error = v.str("error")
    val knocked = v.optBoolean("knocked")
    val roomAct = v.str("roomAct")
    var tab by remember { mutableStateOf(0) }
    BackHandler { Engine.send("fpBack") }
    val tracks = st?.optJSONArray("tracks").objects()
    val artists = st?.optJSONArray("artists").objects()

    SlideIn {
        Box(Modifier.fillMaxSize().background(p.bg).absorb()) {
            LazyColumn(Modifier.fillMaxSize().statusBarsPadding().padding(top = 48.dp), contentPadding = PaddingValues(bottom = 60.dp)) {
                item {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Spacer(Modifier.height(6.dp))
                        RingAvatar(f.avatar, f.name, 108.dp, f.now?.playing == true)
                        Spacer(Modifier.height(12.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Txt(f.name, A.title3, p.text, maxLines = 1)
                            if (f.inRoom) { Spacer(Modifier.width(6.dp)); Tag("в руме", p.voice) }
                        }
                        Txt(listOf("@${f.login}", if (f.since.isNotEmpty()) "друзья с ${f.since}" else "").filter { it.isNotEmpty() }.joinToString(" · "), A.footnote, p.text2, maxLines = 1)
                        // цифры
                        Row(Modifier.fillMaxWidth().padding(top = 18.dp, bottom = 16.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                            FNum(st?.str("month")?.let(::shortDur) ?: "—", "в этом месяце")
                            FNum(st?.str("total")?.let(::shortDur) ?: "—", "всего")
                            FNum(st?.optInt("days")?.toString() ?: "—", "дней с музыкой")
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Box(Modifier.weight(1f)) {
                                Pill("Написать", Modifier.fillMaxWidth(), primary = true) { Engine.send("fpChat") }
                                if (f.unread > 0) Box(
                                    Modifier.align(Alignment.TopEnd).offset(4.dp, (-4).dp).size(20.dp).clip(CircleShape).background(Color.White),
                                    contentAlignment = Alignment.Center,
                                ) { Txt(if (f.unread > 9) "9+" else "${f.unread}", A.tab, p.accent) }
                            }
                            Pill(
                                v.str("roomLabel"), Modifier.weight(1f), icon = if (roomAct == "knock") AIcons.enter else AIcons.together,
                                enabled = !(roomAct == "knock" && knocked),
                            ) { Engine.send("fpRoom") }
                        }
                        Spacer(Modifier.height(16.dp))
                    }
                }
                // что слушает сейчас
                item { NowCard(f) }
                when {
                    st == null -> item {
                        Box(Modifier.fillMaxWidth().padding(30.dp), contentAlignment = Alignment.Center) {
                            if (loading) Spinner() else Txt(error, A.footnote, p.danger)
                        }
                    }
                    st.optInt("totalSec") <= 0 -> item {
                        Txt("Статистики пока нет — или слушает без аккаунта на этом сервере.", A.subhead.copy(textAlign = TextAlign.Center), p.text2, Modifier.fillMaxWidth().padding(32.dp))
                    }
                    else -> {
                        item {
                            // вкладки: любимые треки сеткой · артисты
                            val x by animateFloatAsState(tab.toFloat(), spring(dampingRatio = 0.8f, stiffness = 500f), label = "fptab")
                            BoxWithConstraints(Modifier.padding(top = 10.dp).fillMaxWidth().hairline()) {
                                val cell = maxWidth / 2
                                Row(Modifier.fillMaxWidth().height(46.dp)) {
                                    listOf("Любимые треки", "Артисты").forEachIndexed { i, s ->
                                        Box(Modifier.weight(1f).fillMaxHeight().tap { tab = i }, contentAlignment = Alignment.Center) {
                                            Txt(s, A.subheadM, if (tab == i) p.text else p.text3)
                                        }
                                    }
                                }
                                Box(Modifier.align(Alignment.BottomStart).offset(x = cell * x + cell * 0.25f).width(cell * 0.5f).height(2.dp).background(p.text))
                            }
                        }
                        if (tab == 0) {
                            items(tracks.indices.chunked(3), key = { "ft${it.first()}" }) { row ->
                                Row(Modifier.fillMaxWidth().padding(bottom = 2.dp).animateItem(), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                                    for (i in row) {
                                        val o = tracks[i]
                                        val t = Track.of(o)
                                        Box(Modifier.weight(1f).aspectRatio(0.78f).press(scale = 0.97f) { Engine.send("fpPlay", i) }) {
                                            Cover(t, Modifier.fillMaxSize(), 360, RectangleShape)
                                            Box(Modifier.fillMaxWidth().height(70.dp).align(Alignment.BottomCenter).background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.75f)))))
                                            Column(Modifier.align(Alignment.BottomStart).padding(6.dp)) {
                                                Txt(t?.title ?: "", A.caption, Color.White, maxLines = 1)
                                                Row(verticalAlignment = Alignment.CenterVertically) {
                                                    Ico(G.play, Color.White, 11.dp)
                                                    Spacer(Modifier.width(3.dp))
                                                    Txt("${o.optInt("plays")}", A.footnoteM, Color.White)
                                                }
                                            }
                                        }
                                    }
                                    repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                                }
                            }
                        } else {
                            itemsIndexed(artists, key = { i, a -> "fa$i${a.str("name")}" }) { i, a ->
                                Row(
                                    Modifier.fillMaxWidth().animateItem().press(scale = 0.98f) { Engine.send("artist", a.str("name")) }.padding(horizontal = 16.dp, vertical = 9.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Txt("${i + 1}", A.footnoteM, p.text2, Modifier.width(24.dp))
                                    Box(Modifier.size(44.dp).clip(CircleShape).background(p.soft), contentAlignment = Alignment.Center) {
                                        Txt(a.str("name").take(1).uppercase(), A.headline, p.text2)
                                    }
                                    Spacer(Modifier.width(12.dp))
                                    Txt(a.str("name"), A.callout, p.text, Modifier.weight(1f), maxLines = 1)
                                    Txt(a.str("text"), A.footnote, p.text2)
                                }
                            }
                        }
                    }
                }
            }
            // полоса сверху
            Box(Modifier.fillMaxWidth().background(p.bg).statusBarsPadding().height(48.dp)) {
                IconBtn(G.chevronL, Modifier.align(Alignment.CenterStart).padding(start = 4.dp), tint = p.text, iconSize = 20.dp) { Engine.send("fpBack") }
                Txt("@${f.login}", A.headline, p.text, Modifier.align(Alignment.Center), maxLines = 1)
                IconBtn(G.ellipsis, Modifier.align(Alignment.CenterEnd).padding(end = 4.dp), tint = p.text, iconSize = 20.dp) { Engine.send("fpMore") }
            }
        }
    }
}

private fun shortDur(s: String) = s.replace(" мин", "м").replace(" ч", "ч")

@Composable
private fun FNum(v: String, label: String) {
    val p = LocalPal.current
    Column(Modifier.width(104.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Txt(v, A.title3, p.text, maxLines = 1)
        Txt(label, A.footnote, p.text2, maxLines = 1)
    }
}

/** «Слушает сейчас»: обложка, полоска идёт сама, можно включить у себя с того же места. */
@Composable
private fun NowCard(f: Friend) {
    val p = LocalPal.current
    val n = f.now ?: run {
        Txt("Сейчас ничего не слушает", A.subhead, p.text2, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp))
        return
    }
    val start = remember(n.pos, n.track.id) { System.currentTimeMillis() }
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(n.playing) { while (n.playing) { now = System.currentTimeMillis(); kotlinx.coroutines.delay(500) } }
    val pos = if (n.playing) n.pos + (now - start) / 1000.0 else n.pos
    Column(Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Brush.linearGradient(listOf(p.surface, p.soft))).padding(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Cover(n.track, Modifier.size(64.dp), 200, RoundedCornerShape(10.dp))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (n.playing) { EqBars(true, Color(0xFF30D158), Modifier.size(12.dp)); Spacer(Modifier.width(5.dp)) }
                    Txt(if (n.playing) "слушает сейчас" else if (n.live) "на паузе" else "последний трек · ${n.ago}", A.caption, if (n.playing) Color(0xFF30D158) else p.text2, maxLines = 1)
                }
                Txt(n.track.title, A.headline, p.text, maxLines = 1)
                Txt(n.track.artist, A.footnote, p.text2, maxLines = 1)
            }
        }
        if (n.playing && n.track.duration > 0) {
            Spacer(Modifier.height(10.dp))
            Box(Modifier.fillMaxWidth().height(3.dp).clip(CircleShape).background(p.line)) {
                Box(Modifier.fillMaxWidth((pos / n.track.duration).toFloat().coerceIn(0f, 1f)).fillMaxHeight().background(Color(0xFF30D158)))
            }
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (n.playing) Pill("С того же места", Modifier.weight(1f), primary = true, small = true) { Engine.send("fpSync") }
            Pill(if (n.playing) "С начала" else "Включить", Modifier.weight(1f), small = true, tinted = true) { Engine.send("fpStart") }
        }
    }
}

