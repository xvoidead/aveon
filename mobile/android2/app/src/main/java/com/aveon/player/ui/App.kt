package com.aveon.player.ui

import android.app.Activity
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aveon.player.Engine
import com.aveon.player.Wrapped
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt

enum class Tab(val word: String) { Home("Главная"), Wave("Волна"), Library("Медиатека"), Search("Поиск") }

/** Что показывает раскрытый плеер: обложку, текст или очередь (как три режима Apple Music). */
enum class PMode { Art, Lyrics, Queue }

/** Навигация и состояние раскрытия плеера. Панели движка и его меню/диалоги живут в Engine. */
@Stable
class Nav(val scope: CoroutineScope) {
    var tab by mutableStateOf(Tab.Home)
    var libOpen by mutableStateOf(false)   // в «Медиатеке» открыт раздел (а не список разделов)
    var libView by mutableStateOf("local")
    var searchView by mutableStateOf("")
    var eq by mutableStateOf(false)
    var viz by mutableStateOf(false)
    var wrapped by mutableStateOf<Wrapped?>(null)
    /** Своя шторка (варианты, выбор). */
    var sheet by mutableStateOf<(@Composable ColumnScope.() -> Unit)?>(null)

    /** Нижняя панель свёрнута (листаешь вниз — уступает место). */
    var barCollapsed by mutableStateOf(false)

    /** 0 — плеер свёрнут в мини-плеер, 1 — раскрыт на весь экран. Тянется пальцем. */
    val expand = Animatable(0f)
    var mode by mutableStateOf(PMode.Art)
    /** Где на экране обложка мини-плеера — отсюда она «вылетает» в большой плеер. */
    var miniArt by mutableStateOf(Rect.Zero)

    val playerOpen: Boolean get() = expand.targetValue > 0.5f

    fun openPlayer(m: PMode? = null) {
        if (m != null) mode = m
        scope.launch { expand.animateTo(1f, spring(dampingRatio = 0.86f, stiffness = 260f)) }
    }

    fun closePlayer() {
        scope.launch { expand.animateTo(0f, spring(dampingRatio = 0.9f, stiffness = 300f)) }
    }

    /** Отпустили палец при перетаскивании плеера: доводим до ближайшего края с учётом скорости. */
    fun settle(velocity: Float) {
        val k = expand.value
        val open = if (abs(velocity) > 900f) velocity < 0 else k > 0.5f
        scope.launch {
            expand.animateTo(if (open) 1f else 0f, spring(dampingRatio = 0.86f, stiffness = 280f), initialVelocity = -velocity / 2400f)
        }
    }

    /** Открыть раздел библиотеки движка в «Медиатеке». */
    fun library(view: String? = null) {
        if (view != null) libView = view
        tab = Tab.Library
        libOpen = true
        if (playerOpen) closePlayer()
    }
}

@Composable
fun AveonApp() {
    val theme by Engine.theme.collectAsState()
    AnimatedPal(palOf(theme)) { Root() }
}

@Composable
private fun Root() {
    val p = LocalPal.current
    val scope = rememberCoroutineScope()
    val nav = remember { Nav(scope) }
    val ready by Engine.ready.collectAsState()
    val player by Engine.player.collectAsState()
    val panels by Engine.panels.collectAsState()
    val menu by Engine.menu.collectAsState()
    val ask by Engine.ask.collectAsState()
    val activity = LocalContext.current as? Activity

    LaunchedEffect(Unit) {
        Engine.opens.collect { o ->
            when (o.optString("k")) {
                "visualizer" -> nav.viz = true
                "wrapped" -> o.optJSONObject("data")?.let { nav.wrapped = Wrapped.of(it) }
            }
        }
    }
    // из меню трека выбрали «Перейти к артисту», «Альбомы» и т. п. — движок сменил раздел: показываем его
    val lib by Engine.library.collectAsState()
    var lastView by remember { mutableStateOf("") }
    LaunchedEffect(lib.view, lib.sub) {
        if (lastView.isNotEmpty() && lib.view != lastView && nav.tab != Tab.Search && !(nav.tab == Tab.Library && nav.libOpen) && lib.view !in listOf("home", "wave")) nav.library(lib.view)
        lastView = lib.view
    }
    // караоке включили с компьютера/меню — открываем текст в плеере
    LaunchedEffect(player.karaoke) { if (player.karaoke) nav.openPlayer(PMode.Lyrics) }
    // трек кончился совсем — сворачиваем
    LaunchedEffect(player.track == null) { if (player.track == null && nav.expand.value > 0f) nav.expand.snapTo(0f) }

    BackHandler {
        when {
            ask != null -> Engine.askDone(ask!!.id, null)
            menu != null -> Engine.menuCancel(menu!!.id)
            panels.isNotEmpty() && panels.last().closable -> Engine.closePanel(panels.last().key)
            nav.wrapped != null -> nav.wrapped = null
            nav.viz -> nav.viz = false
            nav.sheet != null -> nav.sheet = null
            nav.eq -> nav.eq = false
            nav.playerOpen && nav.mode != PMode.Art -> { if (player.karaoke) Engine.send("karaokeOff"); nav.mode = PMode.Art }
            nav.playerOpen -> nav.closePlayer()
            nav.tab == Tab.Library && nav.libOpen -> nav.libOpen = false
            nav.tab != Tab.Home -> nav.tab = Tab.Home
            else -> activity?.moveTaskToBack(true)
        }
    }

    // листаешь вниз — панель сворачивается, вверх — разворачивается (как в iOS 26)
    val collapse = remember {
        object : NestedScrollConnection {
            override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                if (consumed.y < -6f) nav.barCollapsed = true
                else if (consumed.y > 6f) nav.barCollapsed = false
                return Offset.Zero
            }
        }
    }
    LaunchedEffect(nav.tab, nav.libOpen) { nav.barCollapsed = false }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        val k = nav.expand.value
        // всё приложение под плеером чуть отъезжает вглубь, как карточка в iOS
        Box(
            Modifier
                .fillMaxSize()
                .graphicsLayer {
                    val s = 1f - 0.07f * k
                    scaleX = s; scaleY = s
                    shape = RoundedCornerShape((k * 34).dp)
                    clip = k > 0f
                }
                .background(p.bg)
                .nestedScroll(collapse),
        ) {
            AnimatedContent(
                targetState = nav.tab,
                transitionSpec = {
                    (fadeIn(tween(230, 60)) + scaleIn(tween(300, easing = FastOutSlowInEasing), initialScale = 0.985f)) togetherWith fadeOut(tween(120))
                },
                label = "tab",
                modifier = Modifier.fillMaxSize(),
            ) { tab ->
                when (tab) {
                    Tab.Home -> HomeScreen(nav)
                    Tab.Wave -> RadioScreen(nav)
                    Tab.Library -> LibraryTab(nav)
                    Tab.Search -> SearchScreen(nav)
                }
            }
            // снизу контент уходит в черноту под панелью
            Box(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(170.dp)
                    .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.55f), Color.Black.copy(alpha = 0.85f)))),
            )
            TabBar(nav, Modifier.align(Alignment.BottomCenter))
        }
        if (k > 0f) Box(Modifier.fillMaxSize().graphicsLayer { alpha = k }.background(Color.Black.copy(alpha = 0.55f)))

        PlayerLayer(nav)
        SheetHost(nav.eq, { nav.eq = false }) { EqSheet() }
        var lastSheet by remember { mutableStateOf(nav.sheet) }
        if (nav.sheet != null) lastSheet = nav.sheet
        SheetHost(nav.sheet != null, { nav.sheet = null }) { lastSheet?.invoke(this) }
        for (panel in panels) key(panel.key) { PanelHost(panel) }
        Overlay(nav.viz) { ArtColors { VisualizerScreen { nav.viz = false } } }
        nav.wrapped?.let { w -> Overlay(true) { ArtColors { WrappedScreen(w) { nav.wrapped = null } } } }
        Reactions()
        MenuSheet(menu)
        AskDialog(ask)
        Toasts(Modifier.align(Alignment.TopCenter))
        AnimatedVisibility(!ready, enter = fadeIn(), exit = fadeOut(tween(600))) { Splash() }
    }
}

@Composable
private fun Splash() {
    val p = LocalPal.current
    Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.size(84.dp).clip(RoundedCornerShape(20.dp)).background(Brush.linearGradient(listOf(p.accent, Color(0xFFFF6A5C)))), contentAlignment = Alignment.Center) {
                Ico(G.play, Color.White, 38.dp)
            }
            Spacer(Modifier.height(18.dp))
            Txt("авеон", T.display(26.sp), p.text)
        }
    }
}

// ---------- стекло: плашки нижней панели ----------

fun Modifier.glass(shape: Shape): Modifier = this
    .graphicsLayer { shadowElevation = 18f; this.shape = shape; clip = true }
    .background(Color(0xFF1E1E20).copy(alpha = 0.93f))
    .border(0.6.dp, Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.16f), Color.White.copy(alpha = 0.04f))), shape)

// ---------- нижняя панель: вкладки, поиск и мини-плеер ----------
// Развёрнута: мини-плеер во всю ширину, под ним — вкладки и кружок поиска.
// Свёрнута (листаешь вниз): вкладки сжимаются в кружок с текущим значком, мини-плеер встаёт между кружками.

private val TABS = listOf(Tab.Home, Tab.Wave, Tab.Library)
private fun tabIcon(t: Tab) = when (t) { Tab.Home -> G.home; Tab.Wave -> G.radio; Tab.Library -> G.library; Tab.Search -> G.search }

@Composable
private fun TabBar(nav: Nav, modifier: Modifier) {
    val pl by Engine.player.collectAsState()
    val hasTrack = pl.track != null
    val c by animateFloatAsState(if (nav.barCollapsed && hasTrack) 1f else 0f, spring(dampingRatio = 0.78f, stiffness = 420f), label = "bar")
    val miniShown by animateFloatAsState(if (hasTrack) 1f else 0f, spring(dampingRatio = 0.8f, stiffness = 380f), label = "mini")
    val d = LocalDensity.current
    val side = 14.dp; val gap = 8.dp
    val tabsH = 62.dp; val miniH = 56.dp; val small = 56.dp
    BoxWithConstraints(modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 6.dp).height(miniH + gap + tabsH)) {
        val w = maxWidth
        // вкладки
        val tabsW = lerpDp(w - side * 2 - gap - tabsH, small, c)
        val tabsHh = lerpDp(tabsH, small, c)
        Box(
            Modifier.align(Alignment.BottomStart).offset(x = side).size(tabsW, tabsHh).glass(CircleShape)
                .then(if (c > 0.5f) Modifier.press { nav.barCollapsed = false } else Modifier),
        ) {
            if (c < 0.99f) TabsRow(nav, Modifier.fillMaxSize().graphicsLayer { alpha = 1f - c * 1.6f })
            if (c > 0.01f) Box(Modifier.fillMaxSize().graphicsLayer { alpha = c }, contentAlignment = Alignment.Center) {
                Ico(tabIcon(if (nav.tab == Tab.Search) Tab.Home else nav.tab), LocalPal.current.accent, 24.dp)
            }
        }
        // поиск
        val sS = lerpDp(tabsH, small, c)
        val searchOn = nav.tab == Tab.Search
        Box(
            Modifier.align(Alignment.BottomEnd).offset(x = -side).size(sS).glass(CircleShape).press(scale = 0.9f) { nav.tab = Tab.Search },
            contentAlignment = Alignment.Center,
        ) { Ico(G.search, if (searchOn) LocalPal.current.accent else Color.White, 23.dp) }
        // мини-плеер
        if (miniShown > 0.01f) {
            val mx = lerpDp(side, side + small + gap, c)
            val mw = lerpDp(w - side * 2, w - side * 2 - (small + gap) * 2, c)
            val bottom = lerpDp(tabsH + gap, 0.dp, c)
            MiniPlayer(
                nav, c,
                Modifier.align(Alignment.BottomStart)
                    .offset { IntOffset(with(d) { mx.roundToPx() }, with(d) { (-bottom).roundToPx() } + ((1f - miniShown) * 90.dp.toPx()).roundToInt()) }
                    .size(mw, miniH)
                    .graphicsLayer { alpha = miniShown },
            )
        }
    }
}

private fun lerpDp(a: Dp, b: Dp, k: Float): Dp = a + (b - a) * k

@Composable
private fun TabsRow(nav: Nav, modifier: Modifier) {
    val p = LocalPal.current
    val sel = TABS.indexOf(nav.tab)
    val x by animateFloatAsState(if (sel < 0) -1f else sel.toFloat(), spring(dampingRatio = 0.72f, stiffness = 500f), label = "tabX")
    BoxWithConstraints(modifier.padding(4.dp)) {
        val cell = maxWidth / TABS.size
        // подсветка выбранной вкладки переезжает пружиной
        if (sel >= 0) Box(
            Modifier.offset(x = cell * x).size(cell, maxHeight).clip(CircleShape).background(Color.White.copy(alpha = 0.1f)),
        )
        Row(Modifier.fillMaxSize()) {
            TABS.forEachIndexed { i, t ->
                val on = i == sel
                val tint by androidx.compose.animation.animateColorAsState(if (on) p.accent else Color.White, tween(220), label = "tabC")
                Column(
                    Modifier.weight(1f).fillMaxHeight().press(scale = 0.9f) {
                        if (nav.tab == t && t == Tab.Library) nav.libOpen = false
                        nav.tab = t
                    },
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Ico(tabIcon(t), tint, 23.dp)
                    Spacer(Modifier.height(2.dp))
                    Txt(t.word, A.tab, tint, maxLines = 1)
                }
            }
        }
    }
}

/** Мини-плеер: тап или свайп вверх — раскрыть плеер, свайп влево/вправо — следующий/предыдущий трек. */
@Composable
private fun MiniPlayer(nav: Nav, c: Float, modifier: Modifier) {
    val p = LocalPal.current
    val pl by Engine.player.collectAsState()
    val t = pl.track ?: return
    val haptic = LocalHapticFeedback.current
    val screenH = with(LocalDensity.current) { LocalConfiguration.current.screenHeightDp.dp.toPx() }
    val swipe = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    var wPx by remember { mutableStateOf(1f) }
    Box(
        modifier
            .glass(CircleShape)
            .onGloballyPositioned { wPx = it.size.width.toFloat() }
            .pointerInput(Unit) {
                awaitEachGesture {
                    val down = awaitFirstDown()
                    val vt = VelocityTracker()
                    vt.addPosition(down.uptimeMillis, down.position)
                    var axis = 0 // 0 — ещё не ясно, 1 — по горизонтали, 2 — по вертикали
                    var total = Offset.Zero
                    var last = down.position
                    while (true) {
                        val ev = awaitPointerEvent()
                        val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                        if (!ch.pressed) break
                        val delta = ch.position - last
                        last = ch.position
                        total += delta
                        vt.addPosition(ch.uptimeMillis, ch.position)
                        if (axis == 0 && total.getDistance() > viewConfiguration.touchSlop) axis = if (abs(total.x) > abs(total.y)) 1 else 2
                        if (axis == 1) { ch.consume(); scope.launch { swipe.snapTo(swipe.value + delta.x) } }
                        if (axis == 2) { ch.consume(); scope.launch { nav.expand.snapTo((nav.expand.value - delta.y / screenH).coerceIn(0f, 1f)) } }
                    }
                    val v = vt.calculateVelocity()
                    when (axis) {
                        0 -> nav.openPlayer(PMode.Art)
                        1 -> scope.launch {
                            val dir = if (abs(swipe.value) > wPx * 0.28f || abs(v.x) > 1200f) (if ((if (abs(v.x) > 1200f) v.x else swipe.value) < 0) 1 else -1) else 0
                            if (dir != 0) {
                                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                swipe.animateTo(-dir * wPx * 0.6f, tween(140))
                                Engine.send(if (dir > 0) "next" else "prev")
                                swipe.snapTo(dir * wPx * 0.5f)
                            }
                            swipe.animateTo(0f, spring(dampingRatio = 0.78f, stiffness = 420f))
                        }
                        2 -> nav.settle(v.y)
                    }
                }
            },
    ) {
        Row(
            Modifier.fillMaxSize().padding(start = 8.dp, end = 6.dp)
                .graphicsLayer { translationX = swipe.value; alpha = 1f - (abs(swipe.value) / wPx * 1.4f).coerceIn(0f, 0.85f) },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(40.dp).onGloballyPositioned { nav.miniArt = it.boundsInRoot() }) {
                // в полёте обложку рисует плеер (FlyingArt), здесь — только когда плеер свёрнут
                if (nav.expand.value <= 0.001f) Cover(t, Modifier.fillMaxSize(), 160, RoundedCornerShape(8.dp))
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Marquee(t.title, A.subheadM, Color.White)
                if (c < 0.6f) Txt(miniSub(pl), A.footnote, if (pl.barrel > 0.5f) p.voice else p.text2, maxLines = 1)
            }
            PlayPauseBtn(pl.playing, 42.dp, 22.dp)
            if (c < 0.5f) IconBtn(G.forward, tint = Color.White, size = 40.dp, iconSize = 22.dp) { Engine.send("next") }
        }
    }
}

private fun miniSub(pl: com.aveon.player.Player): String = when {
    pl.barrel > 0.5f -> "в бочке · ${pl.track?.artist ?: ""}"
    pl.room != null && pl.room.members.size > 1 -> "вместе · ${pl.track?.artist ?: ""}"
    else -> pl.track?.artist ?: ""
}

/** Пауза ↔ играть: значок меняется с пружинкой. */
@Composable
fun PlayPauseBtn(playing: Boolean, size: Dp, icon: Dp, tint: Color = Color.White, modifier: Modifier = Modifier) {
    Box(modifier.size(size).press(scale = 0.84f) { Engine.send("toggle") }, contentAlignment = Alignment.Center) {
        AnimatedContent(
            playing,
            transitionSpec = {
                (scaleIn(spring(dampingRatio = 0.55f, stiffness = 600f), initialScale = 0.4f) + fadeIn(tween(120))) togetherWith
                    (scaleOut(tween(120), targetScale = 0.4f) + fadeOut(tween(100)))
            },
            label = "pp",
        ) { on -> Ico(if (on) G.pause else G.play, tint, icon) }
    }
}

/** Позиция трека сейчас: движок присылает её раз в секунду, между присылками досчитываем сами. */
@Composable
fun rememberPos(pl: com.aveon.player.Player): Double {
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(pl.playing, pl.at) {
        while (pl.playing) {
            now = System.currentTimeMillis()
            kotlinx.coroutines.delay(200)
        }
        now = System.currentTimeMillis()
    }
    return pl.posNow(now)
}

// ---------- экран с большим заголовком (как в iOS) ----------
// Большой заголовок уезжает вместе со списком, а сверху проявляется полоса с маленьким заголовком.

@Composable
fun TitledList(
    title: String,
    state: LazyListState,
    modifier: Modifier = Modifier,
    back: String? = null,
    onBack: (() -> Unit)? = null,
    trailing: @Composable RowScope.() -> Unit = {},
    bare: Boolean = false, // без большого заголовка: экран сам рисует шапку (артист)
    header: (@Composable ColumnScope.() -> Unit)? = null,
    content: LazyListScope.() -> Unit,
) {
    val p = LocalPal.current
    val d = LocalDensity.current
    val bar by remember {
        derivedStateOf {
            if (state.firstVisibleItemIndex > 0) 1f
            else with(d) { ((state.firstVisibleItemScrollOffset - 18.dp.toPx()) / 26.dp.toPx()).coerceIn(0f, 1f) }
        }
    }
    Box(modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), state = state, contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 190.dp)) {
            if (!bare) item(key = "title") {
                Column(Modifier.statusBarsPadding().padding(top = if (back != null) 44.dp else 10.dp)) {
                    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 12.dp, top = 4.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Txt(title, A.large, p.text, Modifier.weight(1f).graphicsLayer { alpha = 1f - bar }, maxLines = 2)
                        trailing()
                    }
                    header?.invoke(this)
                }
            }
            content()
        }
        // полоса сверху
        Box(
            Modifier.fillMaxWidth()
                .graphicsLayer { alpha = if (back != null) 1f else bar }
                .background(Color.Black.copy(alpha = 0.9f * bar))
                .hairline(bar > 0.5f, p.line.copy(alpha = bar))
                .statusBarsPadding()
                .height(44.dp),
        ) {
            Txt(title, A.headline, p.text, Modifier.align(Alignment.Center).padding(horizontal = 90.dp).graphicsLayer { alpha = bar }, maxLines = 1)
            if (back != null && onBack != null) {
                Row(Modifier.align(Alignment.CenterStart).padding(start = 6.dp).press(scale = 0.94f, onClick = onBack).padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Ico(G.chevronL, p.accent, 20.dp)
                    Spacer(Modifier.width(2.dp))
                    Txt(back, A.body, p.accent, maxLines = 1)
                }
            }
        }
    }
}

// ---------- слои и шторки ----------

/** Слой на весь экран: выезжает снизу. */
@Composable
fun Overlay(visible: Boolean, content: @Composable () -> Unit) {
    AnimatedVisibility(
        visible,
        enter = androidx.compose.animation.slideInVertically(spring(dampingRatio = 0.9f, stiffness = 320f)) { it } + fadeIn(tween(160)),
        exit = androidx.compose.animation.slideOutVertically(tween(260)) { it } + fadeOut(tween(220)),
    ) { content() }
}

/** Шторка iOS: скруглённый верх, «ручка», тянешь вниз — закрывается (с учётом скорости). */
@Composable
fun SheetHost(visible: Boolean, onDismiss: () -> Unit, full: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    val p = LocalPal.current
    Box(Modifier.fillMaxSize()) {
        AnimatedVisibility(visible, enter = fadeIn(tween(220)), exit = fadeOut(tween(220))) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.5f)).tap(onDismiss))
        }
        AnimatedVisibility(
            visible,
            modifier = Modifier.align(Alignment.BottomCenter),
            enter = androidx.compose.animation.slideInVertically(spring(dampingRatio = 0.88f, stiffness = 340f)) { it },
            exit = androidx.compose.animation.slideOutVertically(tween(230)) { it },
        ) {
            val dy = remember { Animatable(0f) }
            val scope = rememberCoroutineScope()
            val density = LocalDensity.current
            Column(
                Modifier
                    .fillMaxWidth()
                    .then(if (full) Modifier.fillMaxHeight(0.94f) else Modifier)
                    .offset { IntOffset(0, dy.value.roundToInt()) }
                    .clip(RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp))
                    .background(p.surface)
                    .absorb()
                    .navigationBarsPadding()
                    .imePadding(),
            ) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .pointerInput(Unit) {
                            awaitEachGesture {
                                val down = awaitFirstDown()
                                val vt = VelocityTracker()
                                var last = down.position
                                while (true) {
                                    val ev = awaitPointerEvent()
                                    val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                                    if (!ch.pressed) break
                                    vt.addPosition(ch.uptimeMillis, ch.position)
                                    val dd = ch.position.y - last.y
                                    last = ch.position
                                    ch.consume()
                                    scope.launch { dy.snapTo((dy.value + dd).coerceAtLeast(0f)) }
                                }
                                val v = vt.calculateVelocity().y
                                scope.launch {
                                    if (dy.value > with(density) { 120.dp.toPx() } || v > 1100f) { onDismiss(); dy.snapTo(0f) }
                                    else dy.animateTo(0f, spring(dampingRatio = 0.7f, stiffness = 500f))
                                }
                            }
                        }
                        .padding(top = 6.dp, bottom = 8.dp),
                    contentAlignment = Alignment.Center,
                ) { Box(Modifier.size(width = 36.dp, height = 5.dp).clip(CircleShape).background(Color(0xFF5A5A5E))) }
                content()
            }
        }
    }
}

// ---------- меню движка: как контекстное меню iOS ----------

@Composable
private fun MenuSheet(menu: com.aveon.player.Menu?) {
    val p = LocalPal.current
    var last by remember { mutableStateOf(menu) }
    if (menu != null) last = menu
    Box(Modifier.fillMaxSize()) {
        AnimatedVisibility(menu != null, enter = fadeIn(tween(200)), exit = fadeOut(tween(200))) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.55f)).tap { menu?.let { Engine.menuCancel(it.id) } })
        }
        AnimatedVisibility(
            menu != null,
            modifier = Modifier.align(Alignment.BottomCenter),
            enter = androidx.compose.animation.slideInVertically(spring(dampingRatio = 0.86f, stiffness = 380f)) { it / 2 } + fadeIn(tween(140)) + scaleIn(spring(dampingRatio = 0.8f, stiffness = 420f), initialScale = 0.94f),
            exit = androidx.compose.animation.slideOutVertically(tween(200)) { it / 3 } + fadeOut(tween(160)),
        ) {
            val m = last ?: return@AnimatedVisibility
            Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 10.dp, vertical = 8.dp)) {
                Column(Modifier.fillMaxWidth().heightInScreen(0.72f).clip(RoundedCornerShape(14.dp)).background(Color(0xFF252527)).verticalScroll(rememberScrollState())) {
                    val items = m.items
                    items.forEachIndexed { i, it ->
                        when {
                            it.sep -> Box(Modifier.fillMaxWidth().height(7.dp).background(Color.Black.copy(alpha = 0.35f)))
                            it.note.isNotEmpty() -> Txt(it.note, A.footnote, p.text2, Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 6.dp))
                            else -> {
                                val nextSep = items.getOrNull(i + 1)?.let { n -> n.sep } ?: true
                                Row(
                                    Modifier.fillMaxWidth().cell { Engine.menuPick(m.id, i) }.padding(start = 16.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Row(Modifier.weight(1f).hairline(!nextSep).padding(end = 16.dp, top = 13.dp, bottom = 13.dp), verticalAlignment = Alignment.CenterVertically) {
                                        val col = if (it.danger) p.danger else if (it.muted) p.text2 else p.text
                                        Txt(it.label, A.body, col, Modifier.weight(1f), maxLines = 2)
                                        if (it.count.isNotEmpty()) { Txt(it.count, A.footnote, p.text2); Spacer(Modifier.width(10.dp)) }
                                        Ico(AIcons.byId(it.icon), col, 19.dp)
                                    }
                                }
                            }
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
                Box(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Color(0xFF252527)).cell { Engine.menuCancel(m.id) }.padding(vertical = 15.dp),
                    contentAlignment = Alignment.Center,
                ) { Txt("Отмена", A.headline, p.accent) }
            }
        }
    }
}

// ---------- диалог движка: как алерт iOS ----------

@Composable
private fun AskDialog(ask: com.aveon.player.Ask?) {
    val p = LocalPal.current
    AnimatedVisibility(ask != null, enter = fadeIn(tween(160)), exit = fadeOut(tween(160))) {
        var last by remember { mutableStateOf(ask) }
        if (ask != null) last = ask
        val a = last ?: return@AnimatedVisibility
        var value by remember(a.id) { mutableStateOf(a.value) }
        val focus = remember { FocusRequester() }
        fun done() {
            if (a.input && value.isBlank()) return
            Engine.askDone(a.id, if (a.input) (if (a.password) value else value.trim()) else true)
        }
        val pop = remember(a.id) { Animatable(1.18f) }
        LaunchedEffect(a.id) { pop.animateTo(1f, spring(dampingRatio = 0.72f, stiffness = 520f)) }
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f)).tap { Engine.askDone(a.id, null) }.imePadding(), contentAlignment = Alignment.Center) {
            Column(
                Modifier
                    .graphicsLayer { scaleX = pop.value; scaleY = pop.value }
                    .widthIn(max = 300.dp)
                    .fillMaxWidth(0.78f)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Color(0xFF2A2A2C))
                    .absorb(),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 19.dp, bottom = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Txt(a.title, A.headline.copy(textAlign = TextAlign.Center), p.text)
                    if (a.text.isNotEmpty()) {
                        Spacer(Modifier.height(4.dp))
                        Txt(a.text, A.footnote.copy(textAlign = TextAlign.Center), p.text)
                    }
                    if (a.input) {
                        Spacer(Modifier.height(14.dp))
                        Field(value, { value = it }, Modifier.focusRequester(focus), password = a.password, onDone = ::done)
                        LaunchedEffect(a.id) { focus.requestFocus() }
                    }
                }
                Box(Modifier.fillMaxWidth().height(0.5.dp).background(Color(0xFF48484A)))
                Row(Modifier.fillMaxWidth().height(46.dp)) {
                    Box(Modifier.weight(1f).fillMaxHeight().cell { Engine.askDone(a.id, null) }, contentAlignment = Alignment.Center) { Txt("Отмена", A.body, p.accent) }
                    Box(Modifier.width(0.5.dp).fillMaxHeight().background(Color(0xFF48484A)))
                    Box(Modifier.weight(1f).fillMaxHeight().cell { done() }, contentAlignment = Alignment.Center) {
                        Txt(a.ok, A.headline, if (a.danger) p.danger else p.accent, maxLines = 1)
                    }
                }
            }
        }
    }
}

// ---------- уведомления: плашка сверху ----------

@Composable
private fun Toasts(modifier: Modifier) {
    val p = LocalPal.current
    val list by Engine.toasts.collectAsState()
    Column(modifier.statusBarsPadding().padding(top = 8.dp, start = 20.dp, end = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        for (t in list) {
            key(t.id) {
                val a = remember { Animatable(0f) }
                LaunchedEffect(Unit) { a.animateTo(1f, spring(dampingRatio = 0.68f, stiffness = 420f)) }
                Row(
                    Modifier
                        .padding(bottom = 8.dp)
                        .graphicsLayer { alpha = a.value.coerceIn(0f, 1f); translationY = (1 - a.value) * -70f; scaleX = 0.9f + 0.1f * a.value; scaleY = scaleX }
                        .glass(RoundedCornerShape(22.dp))
                        .padding(horizontal = 18.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (t.err) { Box(Modifier.size(8.dp).clip(CircleShape).background(p.danger)); Spacer(Modifier.width(9.dp)) }
                    Txt(t.msg, A.subheadM, p.text)
                }
            }
        }
    }
}

// ---------- реакции в руме: эмодзи взлетают над экраном у всех ----------

private class Flying(val id: Long, val e: String, val who: String, val x: Float, val dx: Float, val rot: Float)

@Composable
private fun Reactions() {
    val list = remember { mutableStateListOf<Flying>() }
    LaunchedEffect(Unit) {
        var n = 0L
        Engine.reactions.collect { (e, who) ->
            val r = kotlin.random.Random
            list.add(Flying(n++, e, who, 0.25f + r.nextFloat() * 0.5f, (r.nextFloat() - 0.5f) * 140f, (r.nextFloat() - 0.5f) * 40f))
            if (list.size > 24) list.removeAt(0)
        }
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val w = constraints.maxWidth.toFloat()
        val h = constraints.maxHeight.toFloat()
        for (f in list) {
            key(f.id) {
                val a = remember { Animatable(0f) }
                LaunchedEffect(Unit) {
                    a.animateTo(1f, tween(2500, easing = FastOutSlowInEasing))
                    list.remove(f)
                }
                Column(
                    Modifier.graphicsLayer {
                        val k = a.value
                        translationX = w * f.x + f.dx * k
                        translationY = h * 0.62f - h * 0.35f * k
                        alpha = if (k < 0.12f) k / 0.12f else 1f - ((k - 0.12f) / 0.88f)
                        val s = if (k < 0.12f) 0.4f + k / 0.12f * 0.75f else 1.15f - (k - 0.12f) * 0.3f
                        scaleX = s; scaleY = s
                        rotationZ = f.rot * k
                    },
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Txt(f.e, T.display(40.sp, FontWeight.Normal, 0.sp), Color.White)
                    if (f.who.isNotEmpty()) {
                        Box(Modifier.clip(RoundedCornerShape(99.dp)).background(Color.Black.copy(alpha = 0.55f)).padding(horizontal = 7.dp, vertical = 1.dp)) {
                            Txt(f.who, A.caption, Color.White)
                        }
                    }
                }
            }
        }
    }
}
