package com.aveon.player.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.snapping.SnapPosition
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
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
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aveon.player.Engine
import com.aveon.player.Home

@Composable
fun HomeScreen(nav: Nav) {
    val p = LocalPal.current
    var home by remember { mutableStateOf(Home()) }
    val pl by Engine.player.collectAsState()
    val acc by Engine.account.collectAsState()
    val ready by Engine.ready.collectAsState()
    suspend fun reload() { Engine.obj("home")?.let { home = Home.of(it) } }
    LaunchedEffect(ready, pl.track?.id) { if (ready) reload() }
    LaunchedEffect(Unit) { Engine.homeChanged.collect { reload() } }
    val state = rememberLazyListState()

    TitledList(
        "Главная", state,
        trailing = {
            Box {
                IconBtn(AIcons.friends, tint = p.accent, size = 40.dp) { Engine.send("friends") }
                if (pl.friendsBadge) Box(Modifier.align(Alignment.TopEnd).padding(8.dp).size(8.dp).clip(CircleShape).background(p.accent))
            }
            IconBtn(AIcons.settings, tint = p.accent, size = 40.dp) { Engine.send("settings") }
            Spacer(Modifier.width(4.dp))
            Avatar(acc.avatar, acc.name, Modifier.size(34.dp).press(scale = 0.9f) { Engine.send("profile") })
        },
        header = {
            if (home.greeting.isNotEmpty() || home.line.isNotEmpty()) {
                Txt(listOf(home.greeting, home.line).filter { it.isNotEmpty() }.joinToString(". "), A.subhead, p.text2, Modifier.padding(start = 16.dp, end = 16.dp, bottom = 6.dp), maxLines = 2)
            }
        },
    ) {
        // большие карточки «Для тебя» — волна, итоги года и твои плейлисты
        item {
            SectionHead("Для тебя", Modifier.padding(top = 10.dp, bottom = 10.dp))
            val rs = rememberLazyListState()
            LazyRow(
                state = rs,
                flingBehavior = rememberSnapFlingBehavior(rs, SnapPosition.Start),
                contentPadding = PaddingValues(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item { WaveCard(home, pl.wave, pl.playing, pl.waveLoading, nav) }
                if (home.wrapped > 0) item {
                    BigCard(
                        Modifier.press(scale = 0.97f) { Engine.send("wrapped") },
                        Brush.linearGradient(listOf(p.voice, p.voice.mix(Color.Black, 0.55f))),
                        "Итоги ${home.wrapped}", "Сколько музыки, любимые треки и кто ты как слушатель",
                    ) { Txt("${home.wrapped}", T.display(64.sp), Color.White.copy(alpha = 0.9f), Modifier.align(Alignment.Center)) }
                }
                itemsIndexed(home.lists.take(4)) { i, l ->
                    Column(Modifier.width(250.dp).press(scale = 0.97f) { Engine.send("homeList", i); nav.library() }) {
                        Box(Modifier.fillMaxWidth().height(318.dp).clip(RoundedCornerShape(12.dp))) {
                            Img(l.cover, Modifier.fillMaxSize(), 720, RectangleShape) { Ico(AIcons.byId(l.icon) ?: AIcons.list, p.accent, 54.dp) }
                            Box(Modifier.fillMaxWidth().height(130.dp).align(Alignment.BottomCenter).background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.85f)))))
                            Column(Modifier.align(Alignment.BottomStart).padding(16.dp)) {
                                Txt(l.title, A.title3, Color.White, maxLines = 2)
                                Txt(l.meta, A.footnote, Color.White.copy(alpha = 0.7f), maxLines = 1)
                            }
                        }
                    }
                }
            }
        }
        if (home.tracks.isNotEmpty()) {
            item { SectionHead("Недавно слушал", Modifier.padding(top = 28.dp, bottom = 10.dp)) }
            item {
                Carousel(home.tracks.size, 150.dp) { i ->
                    val t = home.tracks[i]
                    Column(Modifier.width(150.dp).press(scale = 0.96f) { Engine.send("homeTrack", i) }) {
                        Box {
                            Cover(t, Modifier.fillMaxWidth().aspectRatio(1f), 400, RoundedCornerShape(8.dp))
                            if (pl.track?.id == t.id) Box(
                                Modifier.align(Alignment.BottomEnd).padding(7.dp).size(28.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.6f)),
                                contentAlignment = Alignment.Center,
                            ) { EqBars(pl.playing, Color.White, Modifier.size(13.dp)) }
                        }
                        Spacer(Modifier.height(6.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Txt(t.title, A.footnote, p.text, Modifier.weight(1f, false), maxLines = 1)
                            if (t.explicit) { Spacer(Modifier.width(4.dp)); Explicit() }
                        }
                        Txt(t.artist, A.footnote, p.text2, maxLines = 1)
                    }
                }
            }
        }
        if (home.lists.isNotEmpty()) {
            item { SectionHead("Плейлисты", Modifier.padding(top = 28.dp, bottom = 10.dp)) { nav.library("albums"); Engine.send("open", "albums", null) } }
            item {
                Carousel(home.lists.size, 150.dp) { i ->
                    val l = home.lists[i]
                    Column(Modifier.width(150.dp).press(scale = 0.96f) { Engine.send("homeList", i); nav.library() }) {
                        Img(l.cover, Modifier.fillMaxWidth().aspectRatio(1f), 400, RoundedCornerShape(8.dp)) {
                            Ico(AIcons.byId(l.icon) ?: AIcons.list, p.accent, 40.dp)
                        }
                        Spacer(Modifier.height(6.dp))
                        Txt(l.title, A.footnote, p.text, maxLines = 1)
                        Txt(l.meta, A.footnote, p.text2, maxLines = 1)
                    }
                }
            }
        }
        if (home.artists.isNotEmpty()) {
            item { SectionHead("Твои артисты", Modifier.padding(top = 28.dp, bottom = 10.dp)) { nav.library("artists"); Engine.send("open", "artists", null) } }
            item {
                Carousel(home.artists.size, 110.dp) { i ->
                    val a = home.artists[i]
                    Column(Modifier.width(110.dp).press(scale = 0.95f) { Engine.send("artist", a.name); nav.library("artists") }, horizontalAlignment = Alignment.CenterHorizontally) {
                        Img(a.cover, Modifier.size(110.dp), 300, CircleShape) { Txt(a.name.take(1).uppercase(), A.title1, p.text2) }
                        Spacer(Modifier.height(8.dp))
                        Txt(a.name, A.footnote, p.text, maxLines = 1)
                    }
                }
            }
        }
        if (home.friends.isNotEmpty()) {
            item { SectionHead("Друзья сейчас слушают", Modifier.padding(top = 28.dp, bottom = 10.dp)) { Engine.send("friends") } }
            item {
                Carousel(home.friends.size, 260.dp) { i ->
                    val f = home.friends[i]
                    Row(
                        Modifier.width(260.dp).clip(RoundedCornerShape(12.dp)).background(p.surface).press(scale = 0.97f) { Engine.send("friendProfile", f.id) }.padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Img(f.cover, Modifier.size(52.dp), 160, RoundedCornerShape(6.dp)) { Ico(G.play, p.text3) }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Txt(f.name, A.footnoteM, p.voice, maxLines = 1)
                            Txt(f.title, A.subhead, p.text, maxLines = 1)
                            Txt(f.artist, A.footnote, p.text2, maxLines = 1)
                        }
                    }
                }
            }
        }
        if (home.tracks.isEmpty() && home.artists.isEmpty() && ready) item {
            Txt("Послушай что-нибудь — здесь появятся любимые треки и артисты. Или просто включи волну.", A.subhead, p.text2, Modifier.padding(16.dp))
        }
    }
}

/** Горизонтальная лента, которая останавливается ровно на карточке. */
@Composable
fun Carousel(n: Int, @Suppress("UNUSED_PARAMETER") itemW: Dp, content: @Composable (Int) -> Unit) {
    val rs = rememberLazyListState()
    LazyRow(
        state = rs,
        flingBehavior = rememberSnapFlingBehavior(rs, SnapPosition.Start),
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        items(n) { i -> content(i) }
    }
}

@Composable
private fun BigCard(modifier: Modifier, bg: Brush, title: String, sub: String, art: @Composable androidx.compose.foundation.layout.BoxScope.() -> Unit) {
    Box(modifier.width(250.dp).height(318.dp).clip(RoundedCornerShape(12.dp)).background(bg)) {
        art()
        Column(Modifier.align(Alignment.BottomStart).padding(16.dp)) {
            Txt(title, A.title3, Color.White, maxLines = 2)
            Txt(sub, A.footnote, Color.White.copy(alpha = 0.75f), maxLines = 2)
        }
    }
}

@Composable
fun Avatar(url: String, name: String, modifier: Modifier) {
    Img(url, modifier, 120, CircleShape) {
        Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(Color(0xFF8E8E93), Color(0xFF5A5A5E)))), contentAlignment = Alignment.Center) {
            Txt(name.trim().take(1).uppercase().ifEmpty { "?" }, A.headline, Color.White)
        }
    }
}

// ---------- карточка волны: «эфир» качается под музыку ----------

@Composable
private fun WaveCard(home: Home, active: Boolean, playing: Boolean, loading: Boolean, nav: Nav) {
    val p = LocalPal.current
    Box(
        Modifier
            .width(250.dp).height(318.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Brush.linearGradient(listOf(p.accent, Color(0xFFB0124F), Color(0xFF3A0B3E))))
            .press(scale = 0.97f) { nav.tab = Tab.Wave },
    ) {
        Air(active && playing, Color.White.copy(alpha = 0.6f), Modifier.fillMaxSize().padding(bottom = 90.dp))
        Column(Modifier.align(Alignment.BottomStart).padding(16.dp)) {
            Txt(if (home.waveYm) "Моя волна" else "Своя волна", A.title3, Color.White)
            Txt(home.waveNote.ifEmpty { "Бесконечный поток под твой вкус" }, A.footnote, Color.White.copy(alpha = 0.75f), maxLines = 2)
        }
        Box(
            Modifier.align(Alignment.TopEnd).padding(14.dp).size(44.dp).press(scale = 0.88f) { Engine.send("waveGo") }.clip(CircleShape).background(Color.White),
            contentAlignment = Alignment.Center,
        ) {
            if (loading) Spinner(color = p.accent, size = 20.dp) else Ico(if (active && playing) G.pause else G.play, p.accent, 20.dp)
        }
    }
}
