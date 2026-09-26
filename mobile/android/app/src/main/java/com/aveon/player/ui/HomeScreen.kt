package com.aveon.player.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aveon.player.Engine
import com.aveon.player.Home
import kotlin.math.sin

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

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 170.dp)) {
        item {
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(start = 20.dp, end = 12.dp, top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Txt("авеон", T.display(15.sp), p.text2, Modifier.weight(1f))
                Box {
                    IconBtn(AIcons.friends, tint = p.text) { Engine.send("friends") }
                    if (pl.friendsBadge) Box(Modifier.align(Alignment.TopEnd).padding(9.dp).size(8.dp).clip(CircleShape).background(p.accent))
                }
                IconBtn(AIcons.settings, tint = p.text) { Engine.send("settings") }
                Avatar(acc.avatar, acc.name, Modifier.padding(start = 4.dp).size(36.dp).press { Engine.send("profile") })
            }
        }
        item {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 18.dp)) {
                Txt(home.greeting.ifEmpty { " " }, T.hero, p.text)
                Spacer(Modifier.height(8.dp))
                Txt(home.line, T.body, p.text2)
            }
        }
        item { WaveCard(home, pl.wave, pl.playing, pl.waveLoading, nav) }
        if (home.wrapped > 0) item {
            Row(
                Modifier.padding(horizontal = 16.dp, vertical = 6.dp).fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(p.voice)
                    .press { Engine.send("wrapped") }.padding(18.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Txt("итоги ${home.wrapped}", T.h2, p.onVoice)
                    Txt("Сколько музыки, любимые треки и кто ты как слушатель", T.small, p.onVoice.copy(alpha = 0.75f))
                }
                Ico(AIcons.chevronR, p.onVoice)
            }
        }
        if (home.tracks.isNotEmpty()) {
            item { SectionHead("Часто слушаешь", Modifier.padding(top = 26.dp, bottom = 12.dp)) }
            item {
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    itemsIndexed(home.tracks) { i, t ->
                        Column(Modifier.width(136.dp).press { Engine.send("homeTrack", i) }) {
                            Box {
                                Cover(t, Modifier.fillMaxWidth().aspectRatio(1f), 360, RoundedCornerShape(18.dp))
                                if (pl.track?.id == t.id) Box(Modifier.align(Alignment.BottomEnd).padding(8.dp).size(30.dp).clip(CircleShape).background(p.accent), contentAlignment = Alignment.Center) { EqBars(pl.playing, p.onAccent, Modifier.size(14.dp)) }
                            }
                            Spacer(Modifier.height(8.dp))
                            Txt(t.title, T.title, p.text, maxLines = 1)
                            Txt(t.artist, T.small, p.text2, maxLines = 1)
                        }
                    }
                }
            }
        }
        if (home.lists.isNotEmpty()) {
            item { SectionHead("Твои плейлисты", Modifier.padding(top = 28.dp, bottom = 12.dp), "все") { nav.library("albums"); Engine.send("open", "albums", null) } }
            item {
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    itemsIndexed(home.lists) { i, l ->
                        Column(Modifier.width(150.dp).press { Engine.send("homeList", i); nav.library() }) {
                            Img(l.cover, Modifier.fillMaxWidth().aspectRatio(1f), 360, RoundedCornerShape(18.dp)) {
                                Ico(AIcons.byId(l.icon) ?: AIcons.list, p.accent, 40.dp)
                            }
                            Spacer(Modifier.height(8.dp))
                            Txt(l.title, T.title, p.text, maxLines = 1)
                            Txt(l.meta, T.small, p.text2, maxLines = 1)
                        }
                    }
                }
            }
        }
        if (home.artists.isNotEmpty()) {
            item { SectionHead("Твои артисты", Modifier.padding(top = 28.dp, bottom = 12.dp), "все") { nav.library("artists"); Engine.send("open", "artists", null) } }
            item {
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    itemsIndexed(home.artists) { _, a ->
                        Column(Modifier.width(96.dp).press { Engine.send("artist", a.name); nav.library("artists") }, horizontalAlignment = Alignment.CenterHorizontally) {
                            Img(a.cover, Modifier.size(96.dp), 240, CircleShape) { Txt(a.name.take(1).uppercase(), T.h1, p.text3) }
                            Spacer(Modifier.height(8.dp))
                            Txt(a.name, T.smallM, p.text, maxLines = 1)
                        }
                    }
                }
            }
        }
        if (home.friends.isNotEmpty()) {
            item { SectionHead("Друзья сейчас слушают", Modifier.padding(top = 28.dp, bottom = 12.dp)) }
            item {
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    itemsIndexed(home.friends) { _, f ->
                        Row(
                            Modifier.width(250.dp).clip(RoundedCornerShape(18.dp)).background(p.soft).press { Engine.send("friendProfile", f.id) }.padding(10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Img(f.cover, Modifier.size(52.dp), 160, RoundedCornerShape(12.dp)) { Ico(AIcons.play, p.text3) }
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Txt(f.name, T.title, p.voice, maxLines = 1)
                                Txt(listOf(f.title, f.artist).filter { it.isNotEmpty() }.joinToString(" — "), T.small, p.text2, maxLines = 2)
                            }
                        }
                    }
                }
            }
        }
        if (home.tracks.isEmpty() && home.artists.isEmpty() && ready) item {
            Txt("Послушай что-нибудь — здесь появятся любимые треки и артисты. Или просто включи волну.", T.body, p.text2, Modifier.padding(24.dp))
        }
    }
}

@Composable
fun Avatar(url: String, name: String, modifier: Modifier) {
    val p = LocalPal.current
    Img(url, modifier, 120, CircleShape) {
        Box(Modifier.fillMaxSize().background(p.accent), contentAlignment = Alignment.Center) {
            Txt(name.trim().take(1).uppercase().ifEmpty { "?" }, T.h3, p.onAccent)
        }
    }
}

// ---------- карточка волны ----------
// Семь линий «эфира» качаются под музыку, пока играет волна; без неё — едва дышат.

@Composable
private fun WaveCard(home: Home, active: Boolean, playing: Boolean, loading: Boolean, nav: Nav) {
    val p = LocalPal.current
    Box(
        Modifier
            .padding(horizontal = 16.dp)
            .fillMaxWidth()
            .height(190.dp)
            .clip(RoundedCornerShape(28.dp))
            .background(Brush.linearGradient(listOf(p.accent.mix(p.bg, 0.15f), p.voice.mix(p.bg, 0.35f))))
            .press { nav.tab = Tab.Wave },
    ) {
        Air(active && playing, p.onAccent.copy(alpha = 0.55f), Modifier.fillMaxSize())
        Column(Modifier.align(Alignment.BottomStart).padding(20.dp)) {
            Txt(if (home.waveYm) "моя волна" else "своя волна", T.h1, p.onAccent)
            Txt(home.waveNote + if (home.waveYm || home.waveNote.isNotEmpty()) "" else "", T.smallM, p.onAccent.copy(alpha = 0.8f), maxLines = 1)
        }
        Box(
            Modifier.align(Alignment.BottomEnd).padding(16.dp).size(58.dp).clip(CircleShape).background(p.onAccent)
                .press { Engine.send("waveGo"); nav.tab = Tab.Wave },
            contentAlignment = Alignment.Center,
        ) {
            if (loading) Spinner(color = p.accent) else Ico(if (active && playing) AIcons.pause else AIcons.play, p.accent, 26.dp)
        }
    }
}

/** «Эфир» — линии, как у волны на компьютере. Энергия — басы спектра. */
@Composable
fun Air(live: Boolean, color: Color, modifier: Modifier, lines: Int = 7, useSpectrum: Boolean = true) {
    val spec by Engine.spectrum.collectAsState()
    SpectrumUser(live && useSpectrum)
    val liveNow by androidx.compose.runtime.rememberUpdatedState(live)
    var phase by remember { mutableFloatStateOf(0f) }
    var energy by remember { mutableFloatStateOf(0.12f) }
    LaunchedEffect(Unit) {
        var last = 0L
        while (true) withFrameNanos { now ->
            val dt = if (last == 0L) 0f else (now - last) / 1e9f
            last = now
            val bass = if (liveNow) (spec.take(6).maxOrNull() ?: 0f) else 0f
            energy += ((if (liveNow) 0.25f + bass * 0.9f else 0.1f) - energy) * minOf(1f, dt * 4f)
            phase += dt * (0.6f + energy * 2.2f)
        }
    }
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        for (k in 0 until lines) {
            val mid = k == lines / 2
            val y0 = h * (0.18f + k * 0.64f / (lines - 1))
            val path = Path()
            var x = 0f
            while (x <= w) {
                val u = x / w
                val y = y0 + sin(u * 6.283f * (1.2f + k * 0.18f) + phase * (1f + k * 0.13f)) * h * 0.05f * energy * (if (mid) 1.6f else 1f)
                if (x == 0f) path.moveTo(x, y) else path.lineTo(x, y)
                x += 6f
            }
            drawPath(path, color.copy(alpha = if (mid) color.alpha else color.alpha * 0.45f), style = Stroke(if (mid) 2.5.dp.toPx() else 1.2.dp.toPx(), cap = StrokeCap.Round))
        }
    }
}

/** Спектр нужен нескольким экранам сразу — движок шлёт его, пока нужен хоть одному. */
object Spec {
    private var users = 0
    fun acquire() { if (users++ == 0) Engine.send("spectrum", true) }
    fun release() { if (--users == 0) Engine.send("spectrum", false) }
}

@Composable
fun SpectrumUser(on: Boolean) {
    DisposableEffect(on) {
        if (on) Spec.acquire()
        onDispose { if (on) Spec.release() }
    }
}
