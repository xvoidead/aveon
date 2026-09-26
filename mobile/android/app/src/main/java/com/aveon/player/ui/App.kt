package com.aveon.player.ui

import android.app.Activity
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.composed
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.foundation.layout.heightIn
import com.aveon.player.Engine
import com.aveon.player.Wrapped
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

enum class Tab(val word: String) { Home("главная"), Wave("волна"), Library("библиотека"), Search("поиск") }

/** Что открыто поверх вкладок. Панели движка и его меню/диалоги живут в Engine. */
@Stable
class Nav {
    var tab by mutableStateOf(Tab.Home)
    var player by mutableStateOf(false)
    var lyrics by mutableStateOf(false)
    var queue by mutableStateOf(false)
    var eq by mutableStateOf(false)
    var viz by mutableStateOf(false)
    var wrapped by mutableStateOf<Wrapped?>(null)
    var libView by mutableStateOf("local")
    var searchView by mutableStateOf("")
    /** Своя шторка экрана (варианты, выбор) — рисуется поверх дока. */
    var sheet by mutableStateOf<(@Composable ColumnScope.() -> Unit)?>(null)

    /** Открыть раздел библиотеки движка и перейти на вкладку «Библиотека». */
    fun library(view: String? = null) {
        if (view != null) libView = view
        tab = Tab.Library
        player = false
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
    val nav = remember { Nav() }
    val ready by Engine.ready.collectAsState()
    val player by Engine.player.collectAsState()
    val panels by Engine.panels.collectAsState()
    val menu by Engine.menu.collectAsState()
    val ask by Engine.ask.collectAsState()
    val activity = LocalContext.current as? Activity

    // визуализатор и итоги года открывает движок (меню «Ещё», главная)
    LaunchedEffect(Unit) {
        Engine.opens.collect { o ->
            when (o.optString("k")) {
                "visualizer" -> nav.viz = true
                "wrapped" -> o.optJSONObject("data")?.let { nav.wrapped = Wrapped.of(it) }
            }
        }
    }
    // из меню трека выбрали «Перейти к артисту», «Альбомы» и т. п. — движок сменил раздел: показываем библиотеку
    val lib by Engine.library.collectAsState()
    var lastView by remember { mutableStateOf("") }
    LaunchedEffect(lib.view, lib.sub) {
        if (lastView.isNotEmpty() && (lib.view != lastView) && nav.tab != Tab.Search && nav.tab != Tab.Library && lib.view !in listOf("home", "wave")) nav.library(lib.view)
        lastView = lib.view
    }

    BackHandler {
        when {
            ask != null -> Engine.askDone(ask!!.id, null)
            menu != null -> Engine.menuCancel(menu!!.id)
            panels.isNotEmpty() && panels.last().closable -> Engine.closePanel(panels.last().key)
            nav.wrapped != null -> nav.wrapped = null
            nav.viz -> nav.viz = false
            player.karaoke -> Engine.send("karaokeOff")
            nav.sheet != null -> nav.sheet = null
            nav.eq -> nav.eq = false
            nav.queue -> nav.queue = false
            nav.lyrics -> nav.lyrics = false
            nav.player -> nav.player = false
            nav.tab != Tab.Home -> nav.tab = Tab.Home
            else -> activity?.moveTaskToBack(true)
        }
    }

    Box(Modifier.fillMaxSize().background(p.bg)) {
        Backdrop()
        AnimatedContent(
            targetState = nav.tab,
            transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(160)) },
            label = "tab",
            modifier = Modifier.fillMaxSize(),
        ) { tab ->
            when (tab) {
                Tab.Home -> HomeScreen(nav)
                Tab.Wave -> WaveScreen(nav)
                Tab.Library -> LibraryScreen(nav, search = false)
                Tab.Search -> LibraryScreen(nav, search = true)
            }
        }
        Dock(nav, Modifier.align(Alignment.BottomCenter))

        PlayerScreen(nav)
        Overlay(nav.lyrics || player.karaoke) { LyricsScreen(nav) }
        SheetHost(nav.queue, { nav.queue = false }) { QueueSheet(nav) }
        SheetHost(nav.eq, { nav.eq = false }) { EqSheet() }
        var lastSheet by remember { mutableStateOf(nav.sheet) }
        if (nav.sheet != null) lastSheet = nav.sheet
        SheetHost(nav.sheet != null, { nav.sheet = null }) { lastSheet?.invoke(this) }
        for (panel in panels) PanelHost(panel)
        Overlay(nav.viz) { VisualizerScreen { nav.viz = false } }
        nav.wrapped?.let { w -> Overlay(true) { WrappedScreen(w) { nav.wrapped = null } } }
        MenuSheet(menu)
        AskDialog(ask)
        Toasts(Modifier.align(Alignment.TopCenter))
        AnimatedVisibility(!ready, enter = fadeIn(), exit = fadeOut(tween(500))) { Splash() }
    }
}

/** Лёгкий отсвет обложки сверху экрана: палитра трека проступает сквозь фон. */
@Composable
private fun Backdrop() {
    val p = LocalPal.current
    Box(
        Modifier
            .fillMaxWidth()
            .height(360.dp)
            .background(Brush.verticalGradient(listOf(p.accent.copy(alpha = 0.13f), p.voice.copy(alpha = 0.05f), Color.Transparent))),
    )
}

@Composable
private fun Splash() {
    val p = LocalPal.current
    Box(Modifier.fillMaxSize().background(p.bg), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Disc(null, true, Modifier.size(140.dp))
            Spacer(Modifier.height(26.dp))
            Txt("авеон", T.display(30.sp), p.text)
        }
    }
}


// ---------- док: мини-плеер и вкладки ----------

@Composable
private fun Dock(nav: Nav, modifier: Modifier) {
    val p = LocalPal.current
    val pl by Engine.player.collectAsState()
    Column(
        modifier
            .navigationBarsPadding()
            .padding(horizontal = 10.dp, vertical = 8.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(26.dp))
            .background(p.surface.copy(alpha = 0.97f))
            .border(1.dp, p.line.copy(alpha = 0.6f), RoundedCornerShape(26.dp)),
    ) {
        val t = pl.track
        if (t != null) {
            var drag by remember { mutableStateOf(0f) }
            Box {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .pointerInput(Unit) {
                            detectVerticalDragGestures(onDragEnd = { if (drag < -40) nav.player = true; drag = 0f }) { _, dy -> drag += dy }
                        }
                        .press { nav.player = true }
                        .padding(start = 8.dp, end = 6.dp, top = 8.dp, bottom = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Disc(t, pl.playing, Modifier.size(48.dp), pl.barrel, labelSize = 160)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Marquee(t.title, T.title, p.text)
                        Txt(dockSub(pl), T.small, if (pl.barrel > 0.5f) p.voice else p.text2, maxLines = 1)
                    }
                    IconBtn(if (pl.playing) AIcons.pause else AIcons.play, size = 44.dp, iconSize = 24.dp) { Engine.send("toggle") }
                    IconBtn(AIcons.next, tint = p.text2, size = 40.dp) { Engine.send("next") }
                }
                Progress(pl, Modifier.align(Alignment.BottomCenter).padding(horizontal = 18.dp))
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 4.dp), horizontalArrangement = Arrangement.SpaceAround) {
            for (tab in Tab.entries) {
                val on = nav.tab == tab
                Column(
                    Modifier.weight(1f).clip(RoundedCornerShape(16.dp)).press { nav.tab = tab }.padding(vertical = 9.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(Modifier.size(4.dp).clip(CircleShape).background(if (on) p.accent else Color.Transparent))
                    Spacer(Modifier.height(4.dp))
                    Txt(tab.word, T.display(12.sp, FontWeight.Bold, (-0.02).em), if (on) p.text else p.text3, maxLines = 1)
                }
            }
        }
    }
}


private fun dockSub(pl: com.aveon.player.Player): String = when {
    pl.barrel > 0.5f -> "в бочке · ${pl.track?.artist ?: ""}"
    pl.room != null && pl.room.members.size > 1 -> "вместе · ${pl.track?.artist ?: ""}"
    else -> pl.track?.artist ?: ""
}

/** Тонкая полоска прогресса: позицию досчитываем сами между присылками движка. */
@Composable
fun Progress(pl: com.aveon.player.Player, modifier: Modifier = Modifier, color: Color = LocalPal.current.accent) {
    val pos = rememberPos(pl)
    val f = if (pl.dur > 0) (pos / pl.dur).toFloat() else 0f
    Box(modifier.fillMaxWidth().height(2.dp).clip(CircleShape).background(LocalPal.current.line.copy(alpha = 0.5f))) {
        Box(Modifier.fillMaxWidth(clamp01(f)).fillMaxHeight().background(color))
    }
}

@Composable
fun rememberPos(pl: com.aveon.player.Player): Double {
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(pl.playing, pl.at) {
        while (pl.playing) {
            now = System.currentTimeMillis()
            kotlinx.coroutines.delay(250)
        }
        now = System.currentTimeMillis()
    }
    return pl.posNow(now)
}

// ---------- шторки и слои ----------

/** Слой на весь экран: выезжает снизу. */
@Composable
fun Overlay(visible: Boolean, content: @Composable () -> Unit) {
    AnimatedVisibility(
        visible,
        enter = slideInVertically(tween(320)) { it / 3 } + fadeIn(tween(220)),
        exit = slideOutVertically(tween(260)) { it / 3 } + fadeOut(tween(200)),
    ) { content() }
}

/** Шторка снизу с затемнением: тянешь вниз — закрывается. */
@Composable
fun SheetHost(visible: Boolean, onDismiss: () -> Unit, full: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    val p = LocalPal.current
    Box(Modifier.fillMaxSize()) {
        AnimatedVisibility(visible, enter = fadeIn(tween(200)), exit = fadeOut(tween(200))) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.5f)).tap(onDismiss))
        }
        AnimatedVisibility(
            visible,
            modifier = Modifier.align(Alignment.BottomCenter),
            enter = slideInVertically(tween(300)) { it },
            exit = slideOutVertically(tween(240)) { it },
        ) {
            val dy = remember { Animatable(0f) }
            val scope = rememberCoroutineScope()
            val density = LocalDensity.current
            Column(
                Modifier
                    .fillMaxWidth()
                    .then(if (full) Modifier.fillMaxHeight(0.94f) else Modifier)
                    .offset { IntOffset(0, dy.value.roundToInt()) }
                    .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                    .background(p.surface)
                    .absorb()
                    .navigationBarsPadding()
                    .imePadding(),
            ) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .pointerInput(Unit) {
                            detectVerticalDragGestures(
                                onDragEnd = {
                                    scope.launch {
                                        if (dy.value > with(density) { 110.dp.toPx() }) { onDismiss(); dy.snapTo(0f) } else dy.animateTo(0f)
                                    }
                                },
                            ) { _, d -> scope.launch { dy.snapTo((dy.value + d).coerceAtLeast(0f)) } }
                        }
                        .padding(top = 10.dp, bottom = 6.dp),
                    contentAlignment = Alignment.Center,
                ) { Box(Modifier.size(width = 38.dp, height = 4.dp).clip(CircleShape).background(p.line)) }
                content()
            }
        }
    }
}

// ---------- меню движка ----------

@Composable
private fun MenuSheet(menu: com.aveon.player.Menu?) {
    val p = LocalPal.current
    var last by remember { mutableStateOf(menu) }
    if (menu != null) last = menu
    SheetHost(menu != null, { menu?.let { Engine.menuCancel(it.id) } }) {
        val m = last ?: return@SheetHost
        Column(Modifier.fillMaxWidth().heightInScreen(0.75f).verticalScroll(rememberScrollState()).padding(bottom = 10.dp)) {
            m.items.forEachIndexed { i, it ->
                when {
                    it.sep -> Box(Modifier.padding(horizontal = 20.dp, vertical = 6.dp).fillMaxWidth().height(1.dp).background(p.line.copy(alpha = 0.6f)))
                    it.note.isNotEmpty() -> Txt(it.note, T.smallM, p.text3, Modifier.padding(start = 22.dp, end = 22.dp, top = 8.dp, bottom = 2.dp))
                    else -> Row(
                        Modifier.fillMaxWidth().press { Engine.menuPick(m.id, i) }.padding(horizontal = 22.dp, vertical = 13.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        val c = if (it.danger) p.danger else if (it.muted) p.text3 else p.text
                        Ico(AIcons.byId(it.icon), if (it.danger) p.danger else p.text2, 20.dp)
                        Spacer(Modifier.width(16.dp))
                        Txt(it.label, T.bodyM, c, Modifier.weight(1f), maxLines = 2)
                        if (it.count.isNotEmpty()) Txt(it.count, T.num, p.text3)
                    }
                }
            }
        }
    }
}

fun Modifier.heightInScreen(frac: Float): Modifier = composed {
    val h = LocalConfiguration.current.screenHeightDp
    heightIn(max = (h * frac).dp)
}

// ---------- диалог движка (ask) ----------

@Composable
private fun AskDialog(ask: com.aveon.player.Ask?) {
    val p = LocalPal.current
    AnimatedVisibility(ask != null, enter = fadeIn(tween(150)), exit = fadeOut(tween(150))) {
        var last by remember { mutableStateOf(ask) }
        if (ask != null) last = ask
        val a = last ?: return@AnimatedVisibility
        var value by remember(a.id) { mutableStateOf(a.value) }
        val focus = remember { FocusRequester() }
        fun done() {
            if (a.input && value.isBlank()) return
            Engine.askDone(a.id, if (a.input) (if (a.password) value else value.trim()) else true)
        }
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.55f)).tap { Engine.askDone(a.id, null) }.imePadding(), contentAlignment = Alignment.Center) {
            Column(
                Modifier
                    .padding(22.dp)
                    .widthIn(max = 420.dp)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(26.dp))
                    .background(p.surface)
                    .absorb()
                    .padding(22.dp),
            ) {
                Txt(a.title, T.h2, p.text)
                if (a.text.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    Txt(a.text, T.body, p.text2)
                }
                if (a.input) {
                    Spacer(Modifier.height(16.dp))
                    Field(value, { value = it }, Modifier.focusRequester(focus), password = a.password, onDone = ::done)
                    LaunchedEffect(a.id) { focus.requestFocus() }
                }
                Spacer(Modifier.height(20.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    Pill("Отмена") { Engine.askDone(a.id, null) }
                    Spacer(Modifier.width(10.dp))
                    Pill(a.ok, primary = !a.danger, danger = a.danger) { done() }
                }
            }
        }
    }
}

/** Поле ввода в стиле приложения. */
@Composable
fun Field(
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    password: Boolean = false,
    number: Boolean = false,
    search: Boolean = false,
    multi: Boolean = false,
    onDone: (() -> Unit)? = null,
) {
    val p = LocalPal.current
    BasicTextField(
        value = value,
        onValueChange = onChange,
        modifier = modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(p.soft).padding(horizontal = 16.dp, vertical = 13.dp),
        textStyle = T.bodyM.copy(color = p.text),
        cursorBrush = SolidColor(p.accent),
        singleLine = !multi,
        visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(
            keyboardType = when { password -> KeyboardType.Password; number -> KeyboardType.Number; else -> KeyboardType.Text },
            imeAction = if (multi) ImeAction.Default else if (search) ImeAction.Search else ImeAction.Done,
        ),
        keyboardActions = KeyboardActions(onDone = { onDone?.invoke() }, onSearch = { onDone?.invoke() }),
        decorationBox = { inner ->
            Box {
                if (value.isEmpty() && placeholder.isNotEmpty()) Txt(placeholder, T.bodyM, p.text3, maxLines = 1)
                inner()
            }
        },
    )
}

// ---------- уведомления ----------

@Composable
private fun Toasts(modifier: Modifier) {
    val p = LocalPal.current
    val list by Engine.toasts.collectAsState()
    Column(modifier.statusBarsPadding().padding(top = 10.dp, start = 16.dp, end = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        for (t in list) {
            androidx.compose.runtime.key(t.id) {
                val a = remember { Animatable(0f) }
                LaunchedEffect(Unit) { a.animateTo(1f, tween(260)) }
                Box(
                    Modifier
                        .padding(bottom = 8.dp)
                        .graphicsLayer { alpha = a.value; translationY = (1 - a.value) * -30f }
                        .clip(RoundedCornerShape(18.dp))
                        .background(if (t.err) p.danger else p.text)
                        .padding(horizontal = 16.dp, vertical = 11.dp),
                ) { Txt(t.msg, T.smallM, if (t.err) Color.White else p.bg) }
            }
        }
    }
}

@Composable
fun BoxScope.CloseButton(onClick: () -> Unit) {
    IconBtn(AIcons.close, Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(10.dp), bg = Color.Black.copy(alpha = 0.25f), onClick = onClick)
}
