package com.aveon.player.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import com.aveon.player.Block
import com.aveon.player.Card
import com.aveon.player.Engine
import com.aveon.player.Home
import com.aveon.player.Library
import kotlinx.coroutines.delay
import kotlin.math.roundToInt

private class Section(val view: String, val title: String, val icon: ImageVector?)

private val SECTIONS by lazy {
    listOf(
        Section("local", "Мои файлы", AIcons.folder),
        Section("albums", "Альбомы и плейлисты", AIcons.list),
        Section("artists", "Артисты", AIcons.user),
        Section("ym", "Яндекс Музыка", AIcons.disk),
        Section("sc", "SoundCloud", AIcons.soundcloud),
        Section("sp", "Spotify", AIcons.plug),
    )
}
private val SEARCH_VIEWS = listOf("ym" to "Яндекс", "sc" to "SoundCloud", "sp" to "Spotify", "local" to "Файлы")

/** «Медиатека»: список разделов, раздел открывается «въездом» справа, как экран в iOS. */
@Composable
fun LibraryTab(nav: Nav) {
    AnimatedContent(
        nav.libOpen,
        transitionSpec = {
            if (targetState) (slideInHorizontally(tween(380, easing = FastOutSlowInEasing)) { it } togetherWith slideOutHorizontally(tween(380, easing = FastOutSlowInEasing)) { -it / 3 } + fadeOut(tween(380)))
            else (slideInHorizontally(tween(340, easing = FastOutSlowInEasing)) { -it / 3 } + fadeIn(tween(200)) togetherWith slideOutHorizontally(tween(340, easing = FastOutSlowInEasing)) { it })
        },
        label = "lib",
    ) { open -> if (open) LibDetail(nav) else LibRoot(nav) }
}

@Composable
private fun LibRoot(nav: Nav) {
    val p = LocalPal.current
    var home by remember { mutableStateOf(Home()) }
    LaunchedEffect(Unit) { Engine.obj("home")?.let { home = Home.of(it) } }
    val state = rememberLazyListState()
    TitledList("Медиатека", state) {
        itemsIndexed(SECTIONS) { i, s ->
            Row(
                Modifier.fillMaxWidth().cell {
                    nav.libView = s.view
                    Engine.send("open", s.view, null)
                    nav.libOpen = true
                }.padding(start = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.width(30.dp), contentAlignment = Alignment.CenterStart) { Ico(s.icon, p.accent, 23.dp) }
                Spacer(Modifier.width(12.dp))
                Row(Modifier.weight(1f).hairline(i < SECTIONS.lastIndex).padding(end = 16.dp, top = 13.dp, bottom = 13.dp), verticalAlignment = Alignment.CenterVertically) {
                    Txt(s.title, A.title3.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Normal), p.text, Modifier.weight(1f))
                    Ico(G.chevronR, p.text3, 15.dp)
                }
            }
        }
        if (home.lists.isNotEmpty()) {
            item { Txt("Плейлисты", A.title2, p.text, Modifier.padding(start = 16.dp, top = 30.dp, bottom = 12.dp)) }
            items(home.lists.indices.chunked(2)) { row ->
                Row(Modifier.padding(horizontal = 16.dp).padding(bottom = 18.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    for (i in row) {
                        val l = home.lists[i]
                        Column(Modifier.weight(1f).press(scale = 0.96f) { Engine.send("homeList", i); nav.library() }) {
                            Img(l.cover, Modifier.fillMaxWidth().aspectRatio(1f), 400, RoundedCornerShape(8.dp)) { Ico(AIcons.byId(l.icon) ?: AIcons.list, p.accent, 44.dp) }
                            Spacer(Modifier.height(6.dp))
                            Txt(l.title, A.footnote, p.text, maxLines = 1)
                            Txt(l.meta, A.footnote, p.text2, maxLines = 1)
                        }
                    }
                    if (row.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun LibDetail(nav: Nav) {
    val lib by Engine.library.collectAsState()
    LaunchedEffect(Unit) {
        if (lib.view != nav.libView) Engine.send("open", nav.libView, null)
    }
    val section = SECTIONS.firstOrNull { it.view == lib.view }
    LibPage(nav, lib, back = "Медиатека", onBack = { nav.libOpen = false }, title = lib.title.ifEmpty { section?.title ?: "" })
}

/** Поиск: поле, переключатель источника (как сегменты iOS) и результаты. */
@Composable
fun SearchScreen(nav: Nav) {
    val lib by Engine.library.collectAsState()
    LaunchedEffect(Unit) {
        val here = SEARCH_VIEWS.any { it.first == lib.view }
        if (nav.searchView.isEmpty()) nav.searchView = if (here) lib.view else "ym"
        if (lib.view != nav.searchView) Engine.send("open", nav.searchView, null)
    }
    var query by remember(lib.view) { mutableStateOf(lib.query) }
    LibPage(nav, lib, title = "Поиск", search = true, queryState = query, onQuery = { query = it }) {
        Segmented(SEARCH_VIEWS, lib.view, Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) { v ->
            nav.searchView = v
            Engine.send("open", v, null)
            if (query.isNotBlank() && v != "local") Engine.send("search", query, true)
        }
    }
}

/** Сегменты iOS: серая подложка, выбранный — светлая плашка, которая переезжает пружиной. */
@Composable
private fun Segmented(opts: List<Pair<String, String>>, cur: String, modifier: Modifier, onPick: (String) -> Unit) {
    val p = LocalPal.current
    val sel = opts.indexOfFirst { it.first == cur }.coerceAtLeast(0)
    val x by animateFloatAsState(sel.toFloat(), spring(dampingRatio = 0.78f, stiffness = 520f), label = "seg")
    BoxWithConstraints(modifier.fillMaxWidth().height(34.dp).clip(RoundedCornerShape(9.dp)).background(Color(0x3D767680)).padding(2.dp)) {
        val cell = maxWidth / opts.size
        Box(Modifier.offset(x = cell * x).size(cell, maxHeight).graphicsLayer { shadowElevation = 4f; shape = RoundedCornerShape(7.dp); clip = true }.background(Color(0xFF636366)))
        Row(Modifier.fillMaxSize()) {
            opts.forEach { (v, s) ->
                Box(Modifier.weight(1f).fillMaxSize().tap { onPick(v) }, contentAlignment = Alignment.Center) {
                    Txt(s, A.footnoteM, p.text, maxLines = 1)
                }
            }
        }
    }
}

/** Страница раздела движка: заголовок, поле, фильтры, кнопки, блоки (треки, сетки, артист). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LibPage(
    nav: Nav,
    lib: Library,
    title: String,
    back: String? = null,
    onBack: (() -> Unit)? = null,
    search: Boolean = false,
    queryState: String? = null,
    onQuery: ((String) -> Unit)? = null,
    top: (@Composable () -> Unit)? = null,
) {
    val p = LocalPal.current
    val pl by Engine.player.collectAsState()
    val state = rememberLazyListState()
    val reorder = remember { Reorder() }
    val rowPx = with(LocalDensity.current) { 70.dp.toPx() }
    LaunchedEffect(lib.view, lib.sub, lib.title) { state.scrollToItem(0) }

    var localQuery by remember(lib.view) { mutableStateOf(lib.query) }
    val query = queryState ?: localQuery
    val setQuery: (String) -> Unit = onQuery ?: { localQuery = it }
    val filters = lib.view == "local" || lib.view == "albums" || lib.view == "artists"
    // В своих файлах, альбомах и артистах фильтруем на ходу, в сервисах ищем по «Найти»
    LaunchedEffect(query) {
        if (query == lib.query) return@LaunchedEffect
        if (filters) { delay(140); Engine.send("search", query, false) }
    }
    val hero = lib.blocks.firstOrNull { it is Block.Hero } as Block.Hero?
    val icons = lib.actions.withIndex().filter { it.value.s.isEmpty() }
    val texts = lib.actions.withIndex().filter { it.value.s.isNotEmpty() }

    TitledList(
        if (hero != null) hero.name else title, state, back = back, onBack = onBack, bare = hero != null,
        trailing = {
            for ((i, a) in icons) IconBtn(AIcons.byId(a.icon), tint = p.accent, size = 40.dp, enabled = !a.disabled) { Engine.send("action", i) }
        },
        header = {
            if (lib.sub2.isNotEmpty() && !search) Txt(lib.sub2, A.subhead, p.text2, Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp))
            Field(
                query, { setQuery(it); if (it.isEmpty()) Engine.send("search", "", false) }, Modifier.padding(horizontal = 16.dp),
                placeholder = lib.placeholder.ifEmpty { if (search) "Артисты, песни, тексты" else "Найти" }, search = true,
                onDone = { Engine.send("search", query, true) },
            )
            top?.invoke()
        },
    ) {
        if (hero != null) item { HeroBlock(hero) }
        if (lib.chips.isNotEmpty()) item {
            LazyRow(Modifier.padding(top = 10.dp), contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                itemsIndexed(lib.chips) { i, c ->
                    ChipA(c.label, c.active, icon = AIcons.byId(c.icon), cover = c.cover, count = c.count) { Engine.send("chip", i) }
                }
            }
        }
        if (texts.isNotEmpty() && hero == null) item {
            // «Слушать» и «Перемешать» — две большие серые кнопки, как в Apple Music
            if (texts.size <= 2) {
                Row(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    for ((i, a) in texts) Pill(a.s, Modifier.weight(1f), icon = AIcons.byId(a.icon), tinted = true, primary = false, enabled = !a.disabled) { Engine.send("action", i) }
                }
            } else {
                FlowRow(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for ((i, a) in texts) Pill(a.s, icon = AIcons.byId(a.icon), tinted = true, small = true, enabled = !a.disabled) { Engine.send("action", i) }
                }
            }
        }
        lib.empty?.let { e -> item { EmptyCard(e) } }
        libBlocks(lib, pl.track?.id, pl.playing, reorder, rowPx)
    }
}

@Composable
private fun EmptyCard(e: com.aveon.player.Empty) {
    val p = LocalPal.current
    Column(Modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        if (e.loading) { Spinner(); Spacer(Modifier.height(14.dp)) }
        if (e.title.isNotEmpty()) Txt(e.title, A.title3.copy(textAlign = androidx.compose.ui.text.style.TextAlign.Center), p.text)
        if (e.text.isNotEmpty()) Txt(e.text, A.subhead.copy(textAlign = androidx.compose.ui.text.style.TextAlign.Center), p.text2, Modifier.padding(top = 6.dp))
        if (e.actions.isNotEmpty()) {
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                e.actions.forEachIndexed { i, a -> Pill(a.s, primary = a.primary, tinted = !a.primary, small = true) { Engine.send("emptyAction", i) } }
            }
        }
    }
}

/** Перетаскивание треков в своём альбоме: подержать и тянуть. */
private class Reorder {
    var from by mutableIntStateOf(-1)
    var dy by mutableFloatStateOf(0f)
}

private fun LazyListScope.libBlocks(lib: Library, current: String?, playing: Boolean, ro: Reorder, rowPx: Float) {
    for (b in lib.blocks) {
        when (b) {
            is Block.Rows -> items(b.n, key = { k -> "r${b.from + k}:${lib.tracks.getOrNull(b.from + k)?.id}" }) { k ->
                val i = b.from + k
                val t = lib.tracks.getOrNull(i) ?: return@items
                val drag = if (!lib.reorder) Modifier else Modifier
                    .zIndex(if (ro.from == i) 1f else 0f)
                    .graphicsLayer { if (ro.from == i) { translationY = ro.dy; shadowElevation = 16f; scaleX = 1.02f; scaleY = 1.02f } }
                    .pointerInput(i, lib.tracks.size) {
                        detectDragGesturesAfterLongPress(
                            onDragStart = { ro.from = i; ro.dy = 0f },
                            onDragEnd = {
                                val to = (i + (ro.dy / rowPx).roundToInt()).coerceIn(0, lib.tracks.size - 1)
                                if (to != i) Engine.send("albumMove", i, to)
                                ro.from = -1
                                ro.dy = 0f
                            },
                            onDragCancel = { ro.from = -1; ro.dy = 0f },
                        ) { ch, amount -> ch.consume(); ro.dy += amount.y }
                    }
                TrackRow(
                    t, t.id == current, playing, Modifier.background(if (ro.from == i) LocalPal.current.surface else Color.Transparent).then(drag),
                    showSource = t.source != lib.view,
                    longMenu = !lib.reorder,
                    divider = k < b.n - 1,
                    onMore = { Engine.send("rowMenu", i) },
                ) { Engine.send("row", i) }
            }
            is Block.Head -> item {
                Row(Modifier.padding(start = 16.dp, end = 16.dp, top = 26.dp, bottom = 8.dp), verticalAlignment = Alignment.Bottom) {
                    Txt(b.s, A.title2, LocalPal.current.text, Modifier.weight(1f, false))
                    if (b.count.isNotEmpty()) Txt("  ${b.count}", A.subhead, LocalPal.current.text2)
                }
            }
            is Block.Grid -> items(b.items.chunked(2)) { row ->
                Row(Modifier.padding(horizontal = 16.dp).padding(top = 6.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    for (c in row) CardTile(c, Modifier.weight(1f))
                    if (row.size == 1) Spacer(Modifier.weight(1f))
                }
            }
            is Block.Strip -> item {
                Carousel(b.items.size, 150.dp) { i -> CardTile(b.items[i], Modifier.width(if (b.items[i].round) 120.dp else 150.dp)) }
            }
            is Block.Hero -> Unit // рисуется шапкой страницы
            is Block.Group -> item {
                val p = LocalPal.current
                Row(Modifier.padding(start = 16.dp, end = 10.dp, top = 22.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Img(b.img, Modifier.size(56.dp), 160, RoundedCornerShape(6.dp)) { Txt("♪", A.title3, p.text3) }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Txt(b.title, A.headline, p.text, maxLines = 1)
                        Txt(b.sub, A.footnote, p.text2, maxLines = 1)
                    }
                    if (b.play > 0) Box(
                        Modifier.size(36.dp).press(scale = 0.88f) { Engine.send("click", b.play) }.clip(CircleShape).background(p.accent),
                        contentAlignment = Alignment.Center,
                    ) { Ico(G.play, Color.White, 16.dp) }
                }
            }
            is Block.Loading -> item {
                Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
                    Spinner()
                    Spacer(Modifier.width(12.dp))
                    Txt(b.s, A.subhead, LocalPal.current.text2)
                }
            }
            is Block.Para -> item { Txt(b.s, A.footnote, LocalPal.current.text2, Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) }
        }
    }
}

@Composable
private fun CardTile(c: Card, modifier: Modifier) {
    val p = LocalPal.current
    Column(modifier.press(scale = 0.96f) { Engine.send("click", c.id) }, horizontalAlignment = if (c.round) Alignment.CenterHorizontally else Alignment.Start) {
        Box {
            Img(c.img, Modifier.fillMaxWidth().aspectRatio(1f), 400, if (c.round) CircleShape else RoundedCornerShape(8.dp)) {
                Txt(c.letter.ifEmpty { "♪" }, A.title1, p.text2)
            }
            if (c.badge.isNotEmpty()) {
                Box(Modifier.align(Alignment.TopStart).padding(7.dp).clip(RoundedCornerShape(5.dp)).background(Color.Black.copy(alpha = 0.55f)).padding(horizontal = 6.dp, vertical = 2.dp)) {
                    Txt(c.badge, A.tab, Color.White)
                }
            }
        }
        Spacer(Modifier.height(6.dp))
        Txt(c.title, A.footnote, p.text, maxLines = 2)
        if (c.sub.isNotEmpty()) Txt(c.sub, A.footnote, p.text2, maxLines = 1)
    }
}

/** Страница артиста: фото во всю ширину, имя крупно поверх, розовая кнопка «играть». */
@Composable
private fun HeroBlock(b: Block.Hero) {
    val p = LocalPal.current
    val play = b.buttons.firstOrNull { it.primary }
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        Box(Modifier.fillMaxWidth().height(maxWidth * 1.05f)) {
            Img(b.banner.ifEmpty { b.img }, Modifier.fillMaxSize(), 1000, RectangleShape) { Txt(b.name.take(1).uppercase(), A.large, p.text2) }
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.45f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.85f))))
            Row(Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.Bottom) {
                Column(Modifier.weight(1f)) {
                    Txt(b.name, A.large, Color.White, maxLines = 2)
                    if (b.stats.isNotEmpty()) Txt(b.stats, A.footnote, Color.White.copy(alpha = 0.75f), Modifier.padding(top = 2.dp))
                }
                if (play != null) Box(
                    Modifier.size(50.dp).press(scale = 0.88f, enabled = !play.disabled) { Engine.send("click", play.id) }.clip(CircleShape).background(p.accent),
                    contentAlignment = Alignment.Center,
                ) { Ico(G.play, Color.White, 22.dp) }
            }
        }
    }
    Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
        if (b.meta.isNotEmpty()) Txt(b.meta, A.footnote, p.text2, Modifier.padding(bottom = 10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (btn in b.buttons) if (btn !== play) Pill(btn.s, icon = AIcons.byId(btn.icon), tinted = true, small = true, enabled = !btn.disabled) { Engine.send("click", btn.id) }
        }
    }
}
