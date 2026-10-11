package com.aveon.player.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import com.aveon.player.Engine
import com.aveon.player.WaveState
import com.aveon.player.WaveWord
import kotlin.math.sin

/** «Волна» — вместо «Радио» Apple Music: большая карточка эфира, настройки одной фразой, что дальше. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RadioScreen(nav: Nav) {
    val p = LocalPal.current
    val pl by Engine.player.collectAsState()
    var w by remember { mutableStateOf(WaveState()) }
    var pick by remember { mutableStateOf<WaveWord?>(null) }
    suspend fun reload() { Engine.obj("wave")?.let { w = WaveState.of(it) } }
    LaunchedEffect(pl.track?.id, pl.wave, pl.playing, pl.waveLoading) { reload() }
    val state = rememberLazyListState()
    val live = w.active && pl.playing

    TitledList("Волна", state) {
        item {
            Box(
                Modifier.padding(horizontal = 16.dp).fillMaxWidth().height(360.dp).clip(RoundedCornerShape(14.dp))
                    .background(Brush.linearGradient(listOf(p.accent, Color(0xFFB0124F), Color(0xFF2B0A35)), start = Offset.Zero, end = Offset(900f, 1400f))),
            ) {
                Air(live, Color.White.copy(alpha = 0.65f), Modifier.fillMaxSize().padding(top = 30.dp, bottom = 120.dp), lines = 9)
                Column(Modifier.padding(18.dp)) {
                    Txt(if (w.ym) "МОЯ ВОЛНА · ЯНДЕКС МУЗЫКА" else "СВОЯ ВОЛНА", A.footnoteM, Color.White.copy(alpha = 0.75f))
                }
                Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(18.dp)) {
                    val t = pl.track
                    if (w.active && t != null) {
                        if (pl.dj) Txt("Говорит диджей", A.footnoteM, Color.White.copy(alpha = 0.8f))
                        Txt(t.title, A.title1, Color.White, maxLines = 2)
                        Txt(t.artist, A.subhead, Color.White.copy(alpha = 0.75f), maxLines = 1)
                    } else {
                        Txt(if (w.ym) "Моя волна" else "Своя волна", A.title1, Color.White)
                        Txt(if (w.ym) "Лайки и пропуски её направляют" else "Из того, что ты слушаешь и дослушиваешь", A.subhead, Color.White.copy(alpha = 0.75f))
                    }
                    Spacer(Modifier.height(16.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Row(
                            Modifier.press(scale = 0.95f) { Engine.send("waveGo") }.clip(CircleShape).background(Color.White).padding(horizontal = 22.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            if (w.loading || pl.waveLoading) Spinner(color = p.accent, size = 18.dp)
                            else Ico(if (live) G.pause else G.play, p.accent, 18.dp)
                            Spacer(Modifier.width(8.dp))
                            Txt(if (live) "Пауза" else if (w.active) "Продолжить" else "Слушать", A.headline, p.accent)
                        }
                        Spacer(Modifier.weight(1f))
                        if (w.active) {
                            RoundGlass(G.heart) { Engine.send("waveLike") }
                            Spacer(Modifier.width(8.dp))
                            RoundGlass(G.heartSlash) { Engine.send("waveDislike") }
                            Spacer(Modifier.width(8.dp))
                            RoundGlass(G.forward) { Engine.send("next") }
                        }
                    }
                }
            }
        }
        item {
            // Настройки одной фразой: «Хочу спокойное, незнакомое, на русском. Диджей говорит через трек»
            SectionHead("Настроить", Modifier.padding(top = 28.dp, bottom = 6.dp))
            val byKey = w.words.associateBy { it.key }
            val parts = buildList {
                add("Хочу" to null)
                if (w.ym) {
                    add("" to byKey["mood"]); add("," to null)
                    add("" to byKey["diversity"]); add("," to null)
                    add("" to byKey["language"]); add("." to null)
                } else {
                    add("" to byKey["diversity"]); add("." to null)
                }
                add("Диджей" to null)
                add("" to byKey["dj"]); add("." to null)
            }
            FlowRow(Modifier.padding(horizontal = 16.dp, vertical = 6.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                for ((s, word) in parts) {
                    if (word == null) {
                        val punct = s == "," || s == "."
                        Txt(if (punct) s else "$s ", A.title2, p.text2, Modifier.padding(end = if (punct) 8.dp else 0.dp))
                    } else {
                        val cur = word.opts.firstOrNull { it.v == word.cur } ?: word.opts.firstOrNull()
                        Txt(
                            cur?.s ?: "",
                            A.title2,
                            p.accent,
                            Modifier
                                .drawBehind {
                                    val y = size.height - 1.dp.toPx()
                                    drawLine(p.accent.copy(alpha = 0.45f), Offset(0f, y), Offset(size.width, y), 1.5.dp.toPx())
                                }
                                .press(onLong = { pick = word }) {
                                    // короткое нажатие — следующее слово по кругу, долгое — все варианты
                                    val i = word.opts.indexOfFirst { it.v == word.cur }
                                    val nx = word.opts[(i + 1).mod(word.opts.size)]
                                    w = w.copy(words = w.words.map { if (it.key == word.key) it.copy(cur = nx.v) else it })
                                    Engine.send("waveSet", word.key, nx.v)
                                },
                        )
                    }
                }
            }
            Txt("Нажми на слово — сменится, подержи — покажу все варианты", A.footnote, p.text2, Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
        }
        if (w.upcoming.isNotEmpty()) {
            item { SectionHead("Дальше в волне", Modifier.padding(top = 28.dp, bottom = 6.dp)) }
            itemsIndexed(w.upcoming) { i, t ->
                TrackRow(t, false, false, divider = i < w.upcoming.lastIndex) { Engine.send("waveUpcoming", i) }
            }
        }
    }

    // все варианты слова — шторкой
    LaunchedEffect(pick) {
        val word = pick ?: return@LaunchedEffect
        pick = null
        nav.sheet = {
            Txt(word.title, A.headline, p.text, Modifier.align(Alignment.CenterHorizontally).padding(bottom = 10.dp))
            Column(Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(p.soft)) {
                word.opts.forEachIndexed { i, o ->
                    Row(
                        Modifier.fillMaxWidth().cell {
                            w = w.copy(words = w.words.map { if (it.key == word.key) it.copy(cur = o.v) else it })
                            Engine.send("waveSet", word.key, o.v)
                            nav.sheet = null
                        }.padding(start = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(Modifier.weight(1f).hairline(i < word.opts.lastIndex).padding(end = 16.dp, top = 13.dp, bottom = 13.dp)) {
                            Txt(o.s, A.body, p.text, Modifier.weight(1f))
                            if (o.v == word.cur) Ico(AIcons.check, p.accent, 20.dp)
                        }
                    }
                }
            }
            Spacer(Modifier.height(20.dp))
        }
    }
}

@Composable
private fun RoundGlass(icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
    Box(
        Modifier.size(44.dp).press(scale = 0.88f, onClick = onClick).clip(CircleShape).background(Color.White.copy(alpha = 0.2f)),
        contentAlignment = Alignment.Center,
    ) { Ico(icon, Color.White, 20.dp) }
}

/** «Эфир» — линии, как у волны на компьютере. Энергия — басы спектра. */
@Composable
fun Air(live: Boolean, color: Color, modifier: Modifier, lines: Int = 7, useSpectrum: Boolean = true) {
    val spec by Engine.spectrum.collectAsState()
    SpectrumUser(live && useSpectrum)
    val liveNow by rememberUpdatedState(live)
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
