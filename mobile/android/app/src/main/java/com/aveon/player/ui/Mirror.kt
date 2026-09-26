package com.aveon.player.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aveon.player.Engine
import com.aveon.player.MNode
import com.aveon.player.Panel
import kotlin.math.roundToInt

// Панели движка — «зеркало» их разметки (renderer/native.js): заголовки, текст, кнопки и поля,
// нарисованные по-своему. Всё, что там можно сделать, можно сделать и здесь — действия уходят в движок.

private val FULL = setOf("settings", "profile", "friends", "auth", "changelog", "admin")

@Composable
fun PanelHost(panel: Panel) {
    val p = LocalPal.current
    if (panel.key in FULL) {
        var shown by remember { mutableStateOf(false) }
        LaunchedEffect(Unit) { shown = true }
        AnimatedVisibility(shown, enter = slideInHorizontally(tween(280)) { it / 4 } + fadeIn(tween(200)), exit = fadeOut()) {
            Box(Modifier.fillMaxSize().background(p.bg).absorb()) {
                Column(Modifier.fillMaxSize().statusBarsPadding().imePadding()) {
                    Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 16.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (panel.closable) IconBtn(AIcons.chevronL) { Engine.closePanel(panel.key) } else Spacer(Modifier.width(12.dp))
                        Txt(panel.title.lowercase(), T.h1, p.text, Modifier.weight(1f).padding(start = 6.dp), maxLines = 1)
                    }
                    Column(
                        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 40.dp),
                    ) { MirrorKids(panel.kids, panel) }
                }
            }
        }
    } else {
        var open by remember { mutableStateOf(false) }
        LaunchedEffect(Unit) { open = true }
        SheetHost(open, { Engine.closePanel(panel.key) }, full = false) {
            Column(Modifier.fillMaxWidth().heightInScreen(0.86f).verticalScroll(rememberScrollState()).padding(start = 18.dp, end = 18.dp, bottom = 24.dp)) {
                Txt(panel.title.lowercase(), T.h1, p.text, Modifier.padding(bottom = 8.dp))
                MirrorKids(panel.kids, panel)
            }
        }
    }
}

@Composable
private fun ColumnScope.MirrorKids(kids: List<MNode>, panel: Panel) {
    for (n in kids) {
        if (skip(n, panel)) continue
        MNodeView(n, panel)
    }
}

// Свой заголовок и крестик у панели уже есть — дубли из разметки не рисуем
private fun skip(n: MNode, panel: Panel): Boolean =
    (n.t == "btn" && n.s.isEmpty() && n.o.optString("icon") == "i-close") ||
        (n.t == "h" && n.s.equals(panel.title, ignoreCase = true))

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MNodeView(n: MNode, panel: Panel) {
    val p = LocalPal.current
    when (n.t) {
        "h" -> {
            val lvl = n.o.optInt("lvl", 2)
            Txt(n.s.lowercase(), if (lvl <= 2) T.h2 else T.h3, p.text, Modifier.padding(top = if (lvl <= 2) 22.dp else 14.dp, bottom = 6.dp))
        }
        "p" -> {
            val quiet = listOf("muted", "note", "hint", "sec-desc", "set-note", "desc").any { n.has(it) } || n.has("together-note")
            val warn = n.has("warn") || n.has("err") || n.has("error")
            Txt(n.s, if (quiet) T.small else T.body, if (warn) p.danger else if (quiet) p.text3 else p.text2, Modifier.padding(vertical = 4.dp))
        }
        "text" -> {
            val bold = n.o.optBoolean("b")
            val badge = n.has("badge") || n.has("count") || n.has("tag")
            if (badge) {
                Box(Modifier.padding(2.dp).clip(RoundedCornerShape(8.dp)).background(p.soft).padding(horizontal = 8.dp, vertical = 2.dp)) { Txt(n.s, T.tiny, p.text2) }
            } else Txt(n.s, if (bold) T.title else T.bodyM, if (n.has("val") || n.has("muted")) p.text3 else p.text, Modifier.padding(vertical = 2.dp))
        }
        "img" -> {
            val src = n.o.optString("src")
            val small = listOf("avatar", "face", "pic", "emoji", "icon").any { n.cls.contains(it) }
            Img(src, if (small) Modifier.size(44.dp) else Modifier.fillMaxWidth().height(180.dp), if (small) 120 else 720, if (small) CircleShape else RoundedCornerShape(18.dp))
        }
        "btn" -> MButton(n)
        "switch" -> {
            var on by remember(n.id, n.o.optBoolean("on")) { mutableStateOf(n.o.optBoolean("on")) }
            Row(Modifier.fillMaxWidth().press { on = !on; Engine.send("setVal", n.id, on, true) }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Txt(n.o.optString("label"), T.bodyM, p.text, Modifier.weight(1f))
                Toggle(on)
            }
        }
        "range" -> MRange(n)
        "input" -> MInput(n)
        "select" -> MSelect(n)
        "seg" -> FlowRow(Modifier.padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            for (b in n.kids) if (b.t == "btn") ChipA(b.s.ifEmpty { b.o.optString("label") }, b.o.optBoolean("on")) { Engine.send("tap", b.id) }
        }
        "field" -> {
            val label = n.o.optString("label")
            val single = n.kids.size == 1 && n.kids[0].t == "switch"
            if (single) {
                val sw = n.kids[0]
                var on by remember(sw.id, sw.o.optBoolean("on")) { mutableStateOf(sw.o.optBoolean("on")) }
                Row(Modifier.fillMaxWidth().press { on = !on; Engine.send("setVal", sw.id, on, true) }.padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Txt(label, T.bodyM, p.text, Modifier.weight(1f))
                    Toggle(on)
                }
            } else {
                Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                    if (label.isNotEmpty()) Txt(label, T.smallM, p.text2, Modifier.padding(bottom = 6.dp))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        for (k in n.kids) Box { Column { MNodeView(k, panel) } }
                    }
                }
            }
        }
        "nav" -> {
            // разделы навигации (настройки: вкладки и подразделы) — фишками; поле поиска — сверху
            val flat = flatten(n)
            flat.filter { it.t == "input" }.forEach { MInput(it) }
            val btns = flat.filter { it.t == "btn" }
            val leaves = btns.filter { it.cls.contains("leaf") }
            for (row in listOf(btns - leaves.toSet(), leaves)) {
                if (row.isEmpty()) continue
                LazyRow(Modifier.padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(row) { b ->
                        ChipA(b.s.ifEmpty { b.o.optString("label") }, b.o.optBoolean("on"), icon = AIcons.byId(b.o.optString("icon"))) { Engine.send("tap", b.id) }
                    }
                }
            }
        }
        "list" -> Column(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            for (k in n.kids) if (!skip(k, panel)) MNodeView(k, panel)
        }
        "form", "box" -> {
            val card = listOf("card", "sec", "pf-card", "msg", "bubble", "call", "item").any { c -> n.cls.split(' ').any { it.contains(c) } }
            val row = n.o.optBoolean("row")
            val mod = if (card) Modifier.fillMaxWidth().padding(vertical = 5.dp).clip(RoundedCornerShape(20.dp)).background(p.surface).padding(14.dp) else Modifier.fillMaxWidth()
            if (row) {
                FlowRow(mod, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    for (k in n.kids) if (!skip(k, panel)) Box { Column { MNodeView(k, panel) } }
                }
            } else {
                Column(mod) { for (k in n.kids) if (!skip(k, panel)) MNodeView(k, panel) }
            }
        }
        else -> Unit
    }
}

private fun flatten(n: MNode): List<MNode> = n.kids.flatMap { if (it.t == "box" || it.t == "list") flatten(it) else listOf(it) }

@Composable
private fun MButton(n: MNode) {
    val p = LocalPal.current
    val o = n.o
    val icon = AIcons.byId(o.optString("icon"))
    val img = o.optString("img")
    val lines = o.optJSONArray("lines")
    val disabled = o.optBoolean("disabled")
    val on = o.optBoolean("on")
    val label = n.s.ifEmpty { o.optString("label") }
    when {
        // «богатая» кнопка: аватар/обложка и несколько строк — строка списка
        lines != null || img.isNotEmpty() -> Row(
            Modifier.fillMaxWidth().padding(vertical = 3.dp).clip(RoundedCornerShape(16.dp)).background(if (on) p.soft else Color.Transparent)
                .press(!disabled) { Engine.send("tap", n.id) }.padding(horizontal = 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (img.isNotEmpty()) { Img(img, Modifier.size(42.dp), 120, CircleShape); Spacer(Modifier.width(12.dp)) }
            else if (icon != null) { Ico(icon, p.text2); Spacer(Modifier.width(12.dp)) }
            Column(Modifier.weight(1f)) {
                if (lines != null) {
                    for (i in 0 until lines.length()) Txt(lines.optString(i), if (i == 0) T.title else T.small, if (i == 0) p.text else p.text2, maxLines = 2)
                } else Txt(label, T.title, p.text, maxLines = 2)
            }
        }
        label.isEmpty() || n.s.isEmpty() && icon != null -> IconBtn(icon, bg = if (on) p.accent else p.soft, tint = if (on) p.onAccent else p.text, enabled = !disabled) { Engine.send("tap", n.id) }
        listOf("chip", "source", "tab", "day", "opt").any { c -> n.cls.contains(c) } || n.cls.isEmpty() && on ->
            ChipA(label, on, icon = icon) { Engine.send("tap", n.id) }
        else -> Pill(
            label, Modifier.padding(vertical = 3.dp), icon = icon, primary = o.optBoolean("primary") || on, danger = o.optBoolean("danger"), enabled = !disabled,
            small = n.cls.contains("small") || n.cls.contains("link"),
        ) { Engine.send("tap", n.id) }
    }
}

@Composable
fun Toggle(on: Boolean) {
    val p = LocalPal.current
    val k by animateFloatAsState(if (on) 1f else 0f, tween(180), label = "toggle")
    Box(Modifier.size(width = 46.dp, height = 28.dp).clip(CircleShape).background(p.line.mix(p.accent, k)).padding(3.dp)) {
        Box(Modifier.offset(x = (18 * k).dp).size(22.dp).clip(CircleShape).background(if (on) p.onAccent else p.text2))
    }
}

@Composable
private fun MRange(n: MNode) {
    val p = LocalPal.current
    val o = n.o
    val min = o.optDouble("min", 0.0)
    val max = o.optDouble("max", 100.0)
    val step = o.optDouble("step", 1.0)
    var v by remember(n.id, o.optDouble("v")) { mutableFloatStateOf(o.optDouble("v", 0.0).toFloat()) }
    val label = o.optString("label")
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (label.isNotEmpty()) Txt(label, T.smallM, p.text2, Modifier.weight(1f))
            else Spacer(Modifier.weight(1f))
            Txt(o.optString("val"), T.num, p.text)
        }
        fun snap(f: Float): Double {
            val raw = min + (max - min) * f
            return if (step > 0) (Math.round(raw / step) * step).coerceIn(min, max) else raw
        }
        Scrub(
            ((v - min) / (max - min).coerceAtLeast(1e-9)).toFloat(), Modifier.fillMaxWidth(), p.accent,
            onInput = { f -> v = snap(f).toFloat(); Engine.send("setVal", n.id, snap(f), false) },
            onDone = { f -> v = snap(f).toFloat(); Engine.send("setVal", n.id, snap(f), true) },
        )
    }
}

@Composable
private fun MInput(n: MNode) {
    val p = LocalPal.current
    val o = n.o
    val remote = o.optString("v")
    var v by remember(n.id) { mutableStateOf(remote) }
    var sent by remember(n.id) { mutableStateOf(remote) }
    // значение поменял движок (очистил после отправки, подставил найденное) — берём его
    LaunchedEffect(remote) { if (remote != sent) { v = remote; sent = remote } }
    val type = o.optString("type")
    val label = o.optString("label")
    Column(Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
        if (label.isNotEmpty() && label != o.optString("ph")) Txt(label, T.smallM, p.text2, Modifier.padding(bottom = 6.dp))
        Field(
            v, { v = it; sent = it; Engine.send("setVal", n.id, it, false) },
            placeholder = o.optString("ph"), password = type == "password", number = type == "number", multi = type == "multi",
            search = type == "search",
            onDone = { Engine.send("setVal", n.id, v, true); Engine.send("submit", n.id) },
        )
    }
}

@Composable
private fun MSelect(n: MNode) {
    val p = LocalPal.current
    val o = n.o
    val opts = o.optJSONArray("opts")
    val cur = o.optString("v")
    var open by remember { mutableStateOf(false) }
    val curText = (0 until (opts?.length() ?: 0)).map { opts!!.getJSONObject(it) }.firstOrNull { it.optString("v") == cur }?.optString("s") ?: cur
    Row(
        Modifier.fillMaxWidth().padding(vertical = 5.dp).clip(RoundedCornerShape(16.dp)).background(p.soft).press { open = !open }.padding(horizontal = 16.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Txt(curText, T.bodyM, p.text, Modifier.weight(1f), maxLines = 1)
        Ico(AIcons.chevronR, p.text3, 18.dp)
    }
    if (open && opts != null) {
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(p.surface)) {
            for (i in 0 until opts.length()) {
                val op = opts.getJSONObject(i)
                val v = op.optString("v")
                Row(Modifier.fillMaxWidth().press { open = false; Engine.send("setVal", n.id, v, true) }.padding(horizontal = 16.dp, vertical = 12.dp)) {
                    Txt(op.optString("s"), T.bodyM, if (v == cur) p.accent else p.text, Modifier.weight(1f))
                    if (v == cur) Ico(AIcons.check, p.accent, 18.dp)
                }
            }
        }
    }
}

@Suppress("unused")
private fun Float.r() = roundToInt()
