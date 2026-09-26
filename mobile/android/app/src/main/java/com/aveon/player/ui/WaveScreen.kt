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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aveon.player.Engine
import com.aveon.player.WaveState
import com.aveon.player.WaveWord

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun WaveScreen(nav: Nav) {
    val p = LocalPal.current
    val pl by Engine.player.collectAsState()
    var w by remember { mutableStateOf(WaveState()) }
    var pick by remember { mutableStateOf<WaveWord?>(null) }
    suspend fun reload() { Engine.obj("wave")?.let { w = WaveState.of(it) } }
    LaunchedEffect(pl.track?.id, pl.wave, pl.playing, pl.waveLoading) { reload() }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 170.dp)) {
        item {
            Box(Modifier.fillMaxWidth().height(430.dp)) {
                Air(pl.wave && pl.playing, p.accent, Modifier.fillMaxSize().padding(top = 40.dp), lines = 9)
                Column(Modifier.statusBarsPadding().padding(horizontal = 22.dp, vertical = 18.dp)) {
                    Txt("волна", T.display(64.sp), p.text)
                    Txt(if (w.ym) "моя волна из Яндекс Музыки" else "своя волна — из того, что ты слушаешь", T.smallM, p.text2)
                }
                Column(Modifier.align(Alignment.BottomStart).padding(horizontal = 22.dp, vertical = 18.dp).fillMaxWidth()) {
                    val t = pl.track
                    if (w.active && t != null) {
                        if (pl.dj) Txt("говорит диджей", T.tiny, p.voice)
                        Txt(t.title, T.h1, p.text, maxLines = 2)
                        Txt(t.artist, T.body, p.text2, maxLines = 1)
                        Spacer(Modifier.height(16.dp))
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier.size(76.dp).clip(CircleShape).background(p.accent).press { Engine.send("waveGo") },
                            contentAlignment = Alignment.Center,
                        ) {
                            if (w.loading || pl.waveLoading) Spinner(color = p.onAccent, size = 30.dp)
                            else Ico(if (w.active && pl.playing) AIcons.pause else AIcons.play, p.onAccent, 32.dp)
                        }
                        Spacer(Modifier.width(14.dp))
                        if (w.active) {
                            IconBtn(AIcons.heart, bg = p.soft, size = 54.dp) { Engine.send("waveLike") }
                            Spacer(Modifier.width(10.dp))
                            IconBtn(AIcons.dislike, bg = p.soft, size = 54.dp) { Engine.send("waveDislike") }
                            Spacer(Modifier.width(10.dp))
                            IconBtn(AIcons.next, bg = p.soft, size = 54.dp) { Engine.send("next") }
                        } else {
                            Txt(if (w.ym) "Лайки и пропуски её направляют" else "Подстраивается под то, что дослушиваешь", T.small, p.text2)
                        }
                    }
                }
            }
        }
        item {
            // Настройки одной фразой: «Хочу спокойное, незнакомое, на русском. Диджей говорит через трек»
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
            FlowRow(
                Modifier.padding(horizontal = 22.dp, vertical = 12.dp).fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(0.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                for ((s, word) in parts) {
                    if (word == null) {
                        Txt(if (s == "," || s == ".") s else "$s ", T.h2, p.text2, Modifier.padding(end = if (s == "," || s == ".") 8.dp else 0.dp))
                    } else {
                        val cur = word.opts.firstOrNull { it.v == word.cur } ?: word.opts.firstOrNull()
                        Txt(
                            cur?.s ?: "",
                            T.h2.copy(textDecoration = TextDecoration.None),
                            p.accent,
                            Modifier
                                .drawBehind {
                                    val y = size.height - 2.dp.toPx()
                                    drawLine(p.accent.copy(alpha = 0.5f), Offset(0f, y), Offset(size.width, y), 2.dp.toPx())
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
            Txt("Нажми на слово — сменится, подержи — покажу все варианты", T.small, p.text3, Modifier.padding(horizontal = 22.dp))
        }
        if (w.upcoming.isNotEmpty()) {
            item { SectionHead("Дальше в волне", Modifier.padding(top = 28.dp, bottom = 8.dp)) }
            itemsIndexed(w.upcoming) { i, t ->
                TrackRow(t, false, false, Modifier.padding(horizontal = 12.dp)) { Engine.send("waveUpcoming", i) }
            }
        }
    }

    // все варианты слова — шторкой поверх дока
    LaunchedEffect(pick) {
        val word = pick ?: return@LaunchedEffect
        pick = null
        nav.sheet = {
            Txt(word.title.lowercase(), T.h2, p.text, Modifier.padding(horizontal = 22.dp, vertical = 8.dp))
            for (o in word.opts) {
                Row(
                    Modifier.fillMaxWidth().press {
                        w = w.copy(words = w.words.map { if (it.key == word.key) it.copy(cur = o.v) else it })
                        Engine.send("waveSet", word.key, o.v)
                        nav.sheet = null
                    }.padding(horizontal = 22.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Txt(o.s, T.bodyM, if (o.v == word.cur) p.accent else p.text, Modifier.weight(1f))
                    if (o.v == word.cur) Ico(AIcons.check, p.accent, 20.dp)
                }
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}
