package com.aveon.player.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import com.aveon.player.Engine
import com.aveon.player.Eq
import com.aveon.player.Track
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import androidx.compose.ui.draw.alpha

// ---------- очередь ----------

@Composable
fun ColumnScope.QueueSheet(nav: Nav) {
    val p = LocalPal.current
    val pl by Engine.player.collectAsState()
    var list by remember { mutableStateOf<List<Track>>(emptyList()) }
    var pos by remember { mutableStateOf(-1) }
    val state = rememberLazyListState()
    LaunchedEffect(pl.track?.id) {
        Engine.obj("queue")?.let { o ->
            list = Track.list(o.optJSONArray("tracks"))
            pos = o.optInt("pos", -1)
            if (pos > 0) state.scrollToItem(maxOf(0, pos - 1))
        }
    }
    Txt("очередь", T.h1, p.text, Modifier.padding(horizontal = 20.dp, vertical = 6.dp))
    Txt(if (pl.wave) "Волна бесконечная — треки подкидываются по ходу" else "${list.size} в очереди", T.small, p.text2, Modifier.padding(horizontal = 20.dp))
    LazyColumn(Modifier.fillMaxWidth().heightInScreen(0.7f), state = state, contentPadding = PaddingValues(10.dp)) {
        itemsIndexed(list) { i, t ->
            TrackRow(t, i == pos, pl.playing, Modifier.alpha(if (i < pos) 0.5f else 1f)) { Engine.send("queuePlay", i); pos = i }
        }
    }
}


// ---------- эквалайзер ----------

@Composable
fun ColumnScope.EqSheet() {
    val p = LocalPal.current
    var eq by remember { mutableStateOf<Eq?>(null) }
    var saving by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { Engine.obj("eq")?.let { eq = Eq.of(it) } }
    val e = eq ?: run { Box(Modifier.fillMaxWidth().height(200.dp), contentAlignment = Alignment.Center) { Spinner() }; return }

    fun set(patch: JSONObject) {
        Engine.scope.launchCatching { Engine.obj("eqSet", patch)?.let { eq = Eq.of(it) } }
    }
    fun gains(g: List<Double>) = JSONArray().apply { g.forEach { put(it) } }

    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Txt("эквалайзер", T.h1, p.text)
            Txt(if (e.enabled) e.name else "выключен", T.small, p.text2)
        }
        Box(Modifier.press { eq = e.copy(enabled = !e.enabled); set(JSONObject().put("enabled", !e.enabled)) }) { Toggle(e.enabled) }
    }
    LazyRow(Modifier.padding(vertical = 10.dp), contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(e.presets) { pr ->
            ChipA(pr.name, e.enabled && e.preset == pr.id) {
                eq = e.copy(preset = pr.id, gains = pr.gains, preamp = pr.preamp, enabled = true)
                set(JSONObject().put("preset", pr.id).put("gains", gains(pr.gains)).put("preamp", pr.preamp).put("enabled", true))
            }
        }
    }

    // полосы: тянешь вверх-вниз, кривая рисуется по ним
    Box(Modifier.fillMaxWidth().height(230.dp).padding(horizontal = 12.dp)) {
        Canvas(Modifier.fillMaxSize().padding(vertical = 22.dp)) {
            val n = e.gains.size
            if (n < 2) return@Canvas
            val step = size.width / n
            val mid = size.height / 2
            drawLine(p.line, Offset(0f, mid), Offset(size.width, mid), 1.dp.toPx())
            val path = Path()
            e.gains.forEachIndexed { i, g ->
                val x = step * (i + 0.5f)
                val y = mid - (g / e.max).toFloat() * mid
                if (i == 0) path.moveTo(x, y) else {
                    val px = step * (i - 0.5f)
                    val py = mid - (e.gains[i - 1] / e.max).toFloat() * mid
                    path.cubicTo((px + x) / 2, py, (px + x) / 2, y, x, y)
                }
            }
            drawPath(path, if (e.enabled) p.accent else p.text3, style = Stroke(3.dp.toPx(), cap = StrokeCap.Round))
        }
        Row(Modifier.fillMaxSize()) {
            e.gains.forEachIndexed { i, g ->
                Band(g, e.max, e.freqs.getOrNull(i) ?: 0, e.enabled, Modifier.weight(1f).fillMaxHeight()) { v, done ->
                    val ng = e.gains.toMutableList().also { it[i] = v }
                    eq = e.copy(gains = ng, preset = "custom", enabled = true)
                    if (done) set(JSONObject().put("gains", gains(ng)).put("preset", "custom").put("enabled", true))
                }
            }
        }
    }
    Column(Modifier.padding(horizontal = 20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Txt("Предусиление", T.smallM, p.text2, Modifier.weight(1f))
            Txt(db(e.preamp), T.num, p.text)
        }
        Scrub(((e.preamp + 12) / 18).toFloat(), Modifier.fillMaxWidth(), p.accent, onInput = { f ->
            eq = e.copy(preamp = ((f * 18 - 12) * 2).roundToInt() / 2.0)
        }, onDone = { f ->
            val v = ((f * 18 - 12) * 2).roundToInt() / 2.0
            set(JSONObject().put("preamp", v))
        })
        Spacer(Modifier.height(10.dp))
        if (saving) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Field(name, { name = it }, Modifier.weight(1f), placeholder = "Название пресета", onDone = {
                    if (name.isNotBlank()) Engine.scope.launchCatching { Engine.obj("eqSaveMine", name.trim())?.let { eq = Eq.of(it) }; saving = false; name = "" }
                })
                Spacer(Modifier.width(8.dp))
                Pill("Сохранить", primary = true, enabled = name.isNotBlank()) {
                    Engine.scope.launchCatching { Engine.obj("eqSaveMine", name.trim())?.let { eq = Eq.of(it) }; saving = false; name = "" }
                }
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Pill("Сохранить как свой", small = true) { saving = true }
                Pill("Поделиться", icon = AIcons.share, small = true) { Engine.send("eqShare", e.preset) }
                Pill("По коду", icon = AIcons.code, small = true) { Engine.send("eqPaste") }
            }
            val mine = e.presets.firstOrNull { it.mine && it.id == e.preset }
            if (mine != null) Pill("Удалить «${mine.name}»", Modifier.padding(top = 8.dp), danger = true, small = true) {
                Engine.scope.launchCatching { Engine.obj("eqDeleteMine", mine.id)?.let { eq = Eq.of(it) } }
            }
        }
        Spacer(Modifier.height(18.dp))
    }
}

private fun db(v: Double) = (if (v > 0) "+" else "") + (if (v % 1.0 == 0.0) v.toInt().toString() else "%.1f".format(v)) + " дБ"
private fun hz(f: Int) = if (f >= 1000) "${f / 1000}к" else "$f"

@Composable
private fun Band(g: Double, max: Double, freq: Int, on: Boolean, modifier: Modifier, onChange: (Double, Boolean) -> Unit) {
    val p = LocalPal.current
    var drag by remember { mutableStateOf<Double?>(null) }
    val v = drag ?: g
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Txt(if (v > 0) "+${v.roundToInt()}" else "${v.roundToInt()}", T.tiny, if (drag != null) p.accent else p.text3)
        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .pointerInput(max) {
                    fun at(y: Float) = ((0.5f - y / size.height) * 2 * max).coerceIn(-max, max).let { (it * 2).roundToInt() / 2.0 }
                    detectVerticalDragGestures(
                        onDragStart = { o -> drag = at(o.y); onChange(drag!!, false) },
                        onDragEnd = { drag?.let { onChange(it, true) }; drag = null },
                        onDragCancel = { drag = null },
                    ) { ch, _ -> ch.consume(); drag = at(ch.position.y); onChange(drag!!, false) }
                },
            contentAlignment = Alignment.Center,
        ) {
            Canvas(Modifier.fillMaxHeight().width(24.dp)) {
                val cx = size.width / 2
                drawLine(p.line.copy(alpha = 0.7f), Offset(cx, 0f), Offset(cx, size.height), 3.dp.toPx(), StrokeCap.Round)
                val y = size.height / 2 - (v / max).toFloat() * size.height / 2
                drawLine(if (on) p.accent else p.text3, Offset(cx, size.height / 2), Offset(cx, y), 3.dp.toPx(), StrokeCap.Round)
                drawCircle(p.text, if (drag != null) 9.dp.toPx() else 7.dp.toPx(), Offset(cx, y))
            }
        }
        Txt(hz(freq), T.tiny, p.text2)
    }
}

fun CoroutineScope.launchCatching(block: suspend () -> Unit) {
    launch {
        try { block() } catch (e: CancellationException) { throw e } catch (e: Exception) { Engine.toast(e.message ?: "Ошибка", true) }
    }
}
