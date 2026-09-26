package com.aveon.player.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.em
import com.aveon.player.Engine
import com.aveon.player.LyricLine
import com.aveon.player.Lyrics

@Composable
fun LyricsScreen(nav: Nav) {
    val p = LocalPal.current
    val pl by Engine.player.collectAsState()
    val t = pl.track
    var ly by remember { mutableStateOf<Lyrics?>(null) }
    var loading by remember { mutableStateOf(false) }
    val karaoke = pl.karaoke

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

    Box(Modifier.fillMaxSize().background(p.bg).absorb()) {
        Img(t?.cover ?: "", Modifier.fillMaxSize().graphicsLayer { alpha = if (karaoke) 0.22f else 0.12f }, 240, RoundedCornerShape(0.dp))
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(p.bg.copy(alpha = 0.7f), p.bg.copy(alpha = 0.3f), p.bg.copy(alpha = 0.85f)))))
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Txt(if (karaoke) "караоке" else "текст", T.h2, if (karaoke) p.accent else p.text)
                    Txt(listOfNotNull(t?.title, t?.artist?.takeIf { it.isNotEmpty() }).joinToString(" — ") + (ly?.from?.takeIf { it.isNotEmpty() }?.let { " · текст: $it" } ?: ""), T.small, p.text2, maxLines = 1)
                }
                IconBtn(if (pl.playing) AIcons.pause else AIcons.play, bg = p.soft) { Engine.send("toggle") }
                Spacer(Modifier.width(6.dp))
                IconBtn(AIcons.close, bg = p.soft) { if (karaoke) Engine.send("karaokeOff") else nav.lyrics = false }
            }
            val l = ly
            when {
                t == null -> Empty("Сначала включи трек", "Текст появится здесь и будет идти вместе с музыкой.")
                loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Spinner() }
                l == null -> Unit
                l.error.isNotEmpty() -> Empty("Текст не загрузился", "Проверь интернет и открой текст ещё раз. ${l.error}")
                l.synced -> Synced(l.lines, pos, karaoke)
                l.plain.isNotEmpty() -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)) {
                    Txt("У этого трека текст без таймкодов, поэтому строки не подсвечиваются.", T.small, p.text3)
                    Spacer(Modifier.height(16.dp))
                    Txt(l.plain, T.display(if (karaoke) 26.sp else 20.sp, androidx.compose.ui.text.font.FontWeight.Bold), p.text)
                }
                l.instrumental -> Empty("Здесь без слов", "В LRCLIB этот трек отмечен как инструментальный.")
                else -> Empty("Текст не нашёлся", "Ни в Musixmatch, ни в LRCLIB нет текста для «${t.title}». Если это свой файл, поправь название и исполнителя в тегах.")
            }
        }
    }
}

@Composable
private fun Empty(title: String, text: String) {
    val p = LocalPal.current
    Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center) {
        Txt(title, T.h1, p.text)
        Spacer(Modifier.height(8.dp))
        Txt(text, T.body, p.text2)
    }
}

@Composable
private fun Synced(lines: List<LyricLine>, pos: Double, karaoke: Boolean) {
    val p = LocalPal.current
    val active = remember(lines, pos) { lines.indexOfLast { it.t <= pos } }
    val state = rememberLazyListState()
    var userAt by remember { mutableLongStateOf(0L) }
    LaunchedEffect(active) {
        if (active >= 0 && System.currentTimeMillis() - userAt > 3000) state.animateScrollToItem(maxOf(0, active), -300)
    }
    LaunchedEffect(state) {
        snapshotFlow { state.isScrollInProgress }.collect { if (it) userAt = System.currentTimeMillis() }
    }
    val size = if (karaoke) 32.sp else 26.sp
    LazyColumn(Modifier.fillMaxSize(), state = state, contentPadding = PaddingValues(start = 24.dp, end = 24.dp, top = 180.dp, bottom = 360.dp)) {
        itemsIndexed(lines) { i, l ->
            val on = i == active
            val past = i < active
            val a by animateFloatAsState(if (on) 1f else if (past) 0.38f else 0.5f, tween(300), label = "line")
            val k by animateFloatAsState(if (on) 1f else 0.94f, tween(300), label = "scale")
            val style = T.display(size, androidx.compose.ui.text.font.FontWeight.ExtraBold, (-0.03).em)
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(vertical = 9.dp)
                    .graphicsLayer { alpha = a; scaleX = k; scaleY = k; transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0f, 0.5f) }
                    .press { Engine.send("seek", l.t); if (!Engine.player.value.playing) Engine.send("toggle") },
            ) {
                val words = l.words
                if (on && words != null) {
                    // richsync: слова загораются по одному
                    val text = buildAnnotatedString {
                        words.forEachIndexed { j, w ->
                            if (j > 0 && !words[j - 1].s.endsWith("-")) append(' ')
                            val sung = w.t <= pos
                            withStyle(SpanStyle(color = if (sung) p.accent else p.text.copy(alpha = 0.55f))) { append(w.s) }
                        }
                    }
                    BasicText(text, style = style.copy(color = p.text))
                } else {
                    Txt(l.s.ifEmpty { "♪ ♪ ♪" }, style, if (on) p.text else p.text)
                }
            }
        }
    }
}

