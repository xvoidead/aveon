package com.aveon.player.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aveon.player.Block
import com.aveon.player.Card
import com.aveon.player.Engine
import com.aveon.player.Library
import kotlinx.coroutines.delay

private val LIB_VIEWS = listOf("local" to "мои файлы", "albums" to "альбомы", "artists" to "артисты", "ym" to "яндекс", "sc" to "soundcloud", "sp" to "spotify")
private val SEARCH_VIEWS = listOf("ym" to "яндекс", "sc" to "soundcloud", "sp" to "spotify", "local" to "мои файлы")

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LibraryScreen(nav: Nav, search: Boolean) {
    val p = LocalPal.current
    val lib by Engine.library.collectAsState()
    val pl by Engine.player.collectAsState()
    val views = if (search) SEARCH_VIEWS else LIB_VIEWS
    val listState = rememberLazyListState()

    // Вход на вкладку: если движок уже в одном из этих разделов (открыли с главной, из меню) — остаёмся
    LaunchedEffect(search) {
        val here = views.any { it.first == lib.view }
        if (search) {
            if (nav.searchView.isEmpty()) nav.searchView = if (here) lib.view else "ym"
            if (lib.view != nav.searchView) Engine.send("open", nav.searchView, null)
        } else {
            if (here) nav.libView = lib.view else Engine.send("open", nav.libView, null)
        }
    }
    LaunchedEffect(lib.view, lib.sub, lib.title) { listState.scrollToItem(0) }

    var query by remember(lib.view) { mutableStateOf(lib.query) }
    val filters = lib.view == "local" || lib.view == "albums" || lib.view == "artists"
    // В своих файлах, альбомах и артистах фильтруем на ходу, в сервисах ищем по «Найти»
    LaunchedEffect(query) {
        if (query == lib.query) return@LaunchedEffect
        if (filters) { delay(120); Engine.send("search", query, false) }
    }

    LazyColumn(Modifier.fillMaxSize(), state = listState, contentPadding = PaddingValues(bottom = 180.dp)) {
        item {
            Column(Modifier.statusBarsPadding().padding(top = 10.dp)) {
                if (search) Txt("поиск", T.display(40.sp), p.text, Modifier.padding(horizontal = 20.dp, vertical = 6.dp))
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(18.dp), verticalAlignment = Alignment.Bottom) {
                    items(views) { (v, word) ->
                        val on = lib.view == v
                        Txt(
                            word,
                            if (search) T.h2 else T.display(if (on) 24.sp else 18.sp),
                            if (on) p.text else p.text3,
                            Modifier.press {
                                if (search) nav.searchView = v else nav.libView = v
                                Engine.send("open", v, null)
                                if (search && query.isNotBlank() && v != "local") Engine.send("search", query, true)
                            }.padding(vertical = 6.dp),
                        )
                    }
                }
                Spacer(Modifier.height(10.dp))
                Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Field(
                        query, { query = it }, Modifier.weight(1f),
                        placeholder = lib.placeholder.ifEmpty { "Поиск" }, search = true,
                        onDone = { Engine.send("search", query, true) },
                    )
                    if (query.isNotEmpty()) IconBtn(AIcons.close, tint = p.text2) { query = ""; Engine.send("search", "", false) }
                }
            }
        }
        if (lib.chips.isNotEmpty()) item {
            LazyRow(Modifier.padding(top = 12.dp), contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                itemsIndexed(lib.chips) { i, c ->
                    ChipA(c.label, c.active, icon = AIcons.byId(c.icon), cover = c.cover, count = c.count) { Engine.send("chip", i) }
                }
            }
        }
        item {
            Column(Modifier.padding(start = 20.dp, end = 16.dp, top = 20.dp, bottom = 6.dp)) {
                if (lib.blocks.none { it is Block.Hero }) {
                    Txt(lib.title.lowercase(), T.h1, p.text, maxLines = 2)
                    if (lib.sub2.isNotEmpty()) Txt(lib.sub2, T.small, p.text2, Modifier.padding(top = 4.dp))
                }
                if (lib.actions.isNotEmpty()) {
                    FlowRow(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        lib.actions.forEachIndexed { i, a ->
                            if (a.s.isEmpty()) IconBtn(AIcons.byId(a.icon), bg = p.soft, enabled = !a.disabled) { Engine.send("action", i) }
                            else Pill(a.s, icon = AIcons.byId(a.icon), primary = a.primary, enabled = !a.disabled) { Engine.send("action", i) }
                        }
                    }
                }
            }
        }
        lib.empty?.let { e -> item { EmptyCard(e) } }
        for (b in lib.blocks) blockItems(b, lib, pl.track?.id, pl.playing)
    }
}

@Composable
private fun EmptyCard(e: com.aveon.player.Empty) {
    val p = LocalPal.current
    Column(Modifier.padding(16.dp).fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(p.soft).padding(22.dp)) {
        if (e.loading) { Spinner(); Spacer(Modifier.height(12.dp)) }
        if (e.title.isNotEmpty()) Txt(e.title, T.h2, p.text)
        if (e.text.isNotEmpty()) Txt(e.text, T.body, p.text2, Modifier.padding(top = 6.dp))
        if (e.actions.isNotEmpty()) {
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                e.actions.forEachIndexed { i, a -> Pill(a.s, primary = a.primary) { Engine.send("emptyAction", i) } }
            }
        }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.blockItems(b: Block, lib: Library, current: String?, playing: Boolean) {
    when (b) {
        is Block.Rows -> items(b.n, key = { k -> "r${b.from + k}:${lib.tracks.getOrNull(b.from + k)?.id}" }) { k ->
            val i = b.from + k
            val t = lib.tracks.getOrNull(i) ?: return@items
            TrackRow(
                t, t.id == current, playing, Modifier.padding(horizontal = 10.dp),
                showSource = t.source != lib.view,
                onMore = { Engine.send("rowMenu", i) },
            ) { Engine.send("row", i) }
        }
        is Block.Head -> item {
            Row(Modifier.padding(start = 20.dp, end = 20.dp, top = 22.dp, bottom = 8.dp), verticalAlignment = Alignment.Bottom) {
                Txt(b.s.lowercase(), T.h2, LocalPal.current.text)
                if (b.count.isNotEmpty()) Txt("  ${b.count}", T.num, LocalPal.current.text3)
            }
        }
        is Block.Grid -> items(b.items.chunked(2)) { row ->
            Row(Modifier.padding(horizontal = 14.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                for (c in row) CardTile(c, Modifier.weight(1f))
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
        is Block.Strip -> item {
            LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                items(b.items) { c -> CardTile(c, Modifier.width(118.dp)) }
            }
        }
        is Block.Hero -> item { HeroBlock(b) }
        is Block.Group -> item {
            val p = LocalPal.current
            Row(Modifier.padding(start = 16.dp, end = 10.dp, top = 18.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Img(b.img, Modifier.size(54.dp), 160, RoundedCornerShape(12.dp)) { Txt("♪", T.h3, p.text3) }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Txt(b.title, T.title, p.text, maxLines = 1)
                    Txt(b.sub, T.small, p.text2, maxLines = 1)
                }
                if (b.play > 0) IconBtn(AIcons.play, bg = p.accent, tint = p.onAccent) { Engine.send("click", b.play) }
            }
        }
        is Block.Loading -> item {
            Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
                Spinner()
                Spacer(Modifier.width(12.dp))
                Txt(b.s, T.small, LocalPal.current.text2)
            }
        }
        is Block.Para -> item { Txt(b.s, T.small, LocalPal.current.text2, Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) }
    }
}

@Composable
private fun CardTile(c: Card, modifier: Modifier) {
    val p = LocalPal.current
    Column(modifier.press { Engine.send("click", c.id) }, horizontalAlignment = if (c.round) Alignment.CenterHorizontally else Alignment.Start) {
        Box {
            Img(c.img, Modifier.fillMaxWidth().aspectRatio(1f), 360, if (c.round) CircleShape else RoundedCornerShape(18.dp)) {
                Txt(c.letter.ifEmpty { "♪" }, T.h1, p.text3)
            }
            if (c.badge.isNotEmpty()) {
                Box(Modifier.align(Alignment.TopStart).padding(8.dp).clip(RoundedCornerShape(8.dp)).background(p.accent).padding(horizontal = 7.dp, vertical = 3.dp)) {
                    Txt(c.badge, T.tiny, p.onAccent)
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        Txt(c.title, T.title, p.text, maxLines = 2)
        if (c.sub.isNotEmpty()) Txt(c.sub, T.small, p.text2, maxLines = 1)
    }
}

@Composable
private fun HeroBlock(b: Block.Hero) {
    val p = LocalPal.current
    Box(Modifier.fillMaxWidth().height(380.dp)) {
        Img(b.banner.ifEmpty { b.img }, Modifier.fillMaxSize(), 900, RoundedCornerShape(0.dp))
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, p.bg.copy(alpha = 0.6f), p.bg))))
        Column(Modifier.align(Alignment.BottomStart).padding(20.dp)) {
            Img(b.img, Modifier.size(84.dp), 240, CircleShape) { Txt(b.name.take(1).uppercase(), T.h1, p.text3) }
            Spacer(Modifier.height(12.dp))
            Txt("артист", T.tiny, p.text2)
            Txt(b.name, T.display(34.sp), p.text, maxLines = 2)
            if (b.stats.isNotEmpty()) Txt(b.stats, T.small, p.text2, Modifier.padding(top = 4.dp))
            if (b.meta.isNotEmpty()) Txt(b.meta, T.small, p.text3)
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (btn in b.buttons) Pill(btn.s, icon = AIcons.byId(btn.icon), primary = btn.primary, enabled = !btn.disabled) { Engine.send("click", btn.id) }
            }
        }
    }
}
