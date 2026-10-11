package com.aveon.player.ui

import android.os.Build
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aveon.player.Engine
import com.aveon.player.LyricLine
import com.aveon.player.Lyrics
import com.aveon.player.Player
import kotlin.math.abs
import kotlin.math.min

/** Текст песни внутри плеера: строки идут вместе с голосом, тап по строке — перемотка к ней. */
@Composable
fun LyricsView(pl: Player, modifier: Modifier) {
    val t = pl.track
    var ly by remember { mutableStateOf<Lyrics?>(null) }
    var loading by remember { mutableStateOf(false) }

    LaunchedEffect(t?.id) {
        if (t == null) { ly = null; return@LaunchedEffect }
        if (ly?.id == t.id) return@LaunchedEffect
        loading = true
        ly = try {
            (Engine.call("lyrics") as? org.json.JSONObject)?.let { Lyrics.of(it) }
        } catch (e: Exception) {
            Lyrics(t.id, "", emptyList(), "", false, false, e.message ?: "Текст не загрузился")
        }
        loading = false
    }

    // позиция каждый кадр: строки и слова загораются вместе с голосом
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) withFrameNanos { now = System.currentTimeMillis() } }
    val pos = pl.posNow(now) + 0.2

    Box(modifier) {
        val l = ly
        when {
            t == null -> Note("Сначала включи трек", "Текст появится здесь и будет идти вместе с музыкой.")
            loading -> Box(Modifier.fillMaxSize(), contentAlignment = androidx.compose.ui.Alignment.Center) { Spinner(color = Color.White.copy(alpha = 0.6f)) }
            l == null -> Unit
            l.error.isNotEmpty() -> Note("Текст не загрузился", "Проверь интернет и открой текст ещё раз. ${l.error}")
            l.synced -> Synced(l, pos, pl.karaoke)
            l.plain.isNotEmpty() -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 28.dp, vertical = 16.dp)) {
                Txt(l.plain, A.title2.copy(lineHeight = 32.sp), Color.White)
                Spacer(Modifier.height(16.dp))
                Txt("Текст без таймкодов — строки не подсвечиваются." + from(l), A.footnote, Color.White.copy(alpha = 0.45f))
            }
            l.instrumental -> Note("Здесь без слов", "В LRCLIB этот трек отмечен как инструментальный.")
            else -> Note("Текст не нашёлся", "Ни в Musixmatch, ни в LRCLIB нет текста для «${t.title}». Если это свой файл, поправь название и исполнителя в тегах.")
        }
    }
}

private fun from(l: Lyrics) = if (l.from.isNotEmpty()) " Текст: ${l.from}." else ""

@Composable
private fun Note(title: String, text: String) {
    Column(Modifier.fillMaxSize().padding(horizontal = 28.dp), verticalArrangement = Arrangement.Center) {
        Txt(title, A.title2, Color.White)
        Spacer(Modifier.height(8.dp))
        Txt(text, A.subhead, Color.White.copy(alpha = 0.6f))
    }
}

@Composable
private fun Synced(ly: Lyrics, pos: Double, karaoke: Boolean) {
    val lines = ly.lines
    val active = remember(lines, pos) { lines.indexOfLast { it.t <= pos } }
    val state = rememberLazyListState()
    var userAt by remember { mutableLongStateOf(0L) }
    val d = LocalDensity.current
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val lead = with(d) { (maxHeight * 0.2f).toPx() }.toInt()
        // активная строка держится в верхней трети; полистал сам — три секунды не мешаем
        LaunchedEffect(active) {
            if (active >= 0 && System.currentTimeMillis() - userAt > 3000) state.animateScrollToItem(active, -lead)
        }
        LaunchedEffect(state) {
            snapshotFlow { state.isScrollInProgress }.collect { if (it) userAt = System.currentTimeMillis() }
        }
        val userScrolling = System.currentTimeMillis() - userAt < 3000
        val style = A.lyric.copy(fontSize = if (karaoke) 36.sp else 30.sp, lineHeight = if (karaoke) 42.sp else 36.sp)
        LazyColumn(Modifier.fillMaxSize(), state = state, contentPadding = PaddingValues(start = 28.dp, end = 36.dp, top = 24.dp, bottom = 320.dp)) {
            itemsIndexed(lines) { i, line ->
                val on = i == active
                val dist = if (active < 0) 2 else abs(i - active)
                val a by animateFloatAsState(if (on) 1f else if (userScrolling) 0.55f else if (i < active) 0.28f else 0.36f, tween(380), label = "la")
                val k by animateFloatAsState(if (on) 1f else 0.94f, spring(dampingRatio = 0.7f, stiffness = 220f), label = "ls")
                val blur = if (on || userScrolling || Build.VERSION.SDK_INT < 31) 0f else min(3f, dist * 1.1f)
                Box(
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = 10.dp)
                        .graphicsLayer { alpha = a; scaleX = k; scaleY = k; transformOrigin = TransformOrigin(0f, 0.5f) }
                        .then(if (blur > 0f) Modifier.blur(blur.dp) else Modifier)
                        .press(scale = 0.97f) { Engine.send("seek", line.t); if (!Engine.player.value.playing) Engine.send("toggle") },
                ) {
                    LineText(line, on, pos, style)
                }
            }
            item {
                if (ly.from.isNotEmpty()) Txt("Текст: ${ly.from}", A.footnote, Color.White.copy(alpha = 0.4f), Modifier.padding(top = 24.dp))
            }
        }
    }
}

@Composable
private fun LineText(line: LyricLine, on: Boolean, pos: Double, style: androidx.compose.ui.text.TextStyle) {
    val words = line.words
    when {
        line.s.isBlank() -> Pause(on)
        on && words != null -> {
            // слова загораются по одному (richsync)
            val text = buildAnnotatedString {
                words.forEachIndexed { j, w ->
                    if (j > 0 && !words[j - 1].s.endsWith("-")) append(' ')
                    withStyle(SpanStyle(color = if (w.t <= pos) Color.White else Color.White.copy(alpha = 0.4f))) { append(w.s) }
                }
            }
            BasicText(text, style = style.copy(color = Color.White))
        }
        else -> Txt(line.s, style, Color.White)
    }
}

/** Проигрыш без слов: три точки, которые «дышат» (как в Apple Music). */
@Composable
private fun Pause(on: Boolean) {
    val tr = rememberInfiniteTransition(label = "dots")
    val ph by tr.animateFloat(0f, 1f, infiniteRepeatable(tween(1400, easing = LinearEasing), RepeatMode.Reverse), label = "ph")
    Row(Modifier.padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for (i in 0..2) {
            val s = if (on) 0.75f + 0.35f * ((ph + i * 0.2f) % 1f) else 0.8f
            Box(Modifier.size(12.dp).graphicsLayer { scaleX = s; scaleY = s }.clip(CircleShape).background(Color.White))
        }
    }
}
