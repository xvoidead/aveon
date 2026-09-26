package com.aveon.player.ui

import android.os.Build
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.aveon.player.Engine
import com.aveon.player.Player
import kotlinx.coroutines.launch
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.roundToInt
import kotlin.math.sin

@Composable
fun PlayerScreen(nav: Nav) {
    val pl by Engine.player.collectAsState()
    AnimatedVisibility(
        nav.player && pl.track != null,
        enter = slideInVertically(tween(340)) { it } + fadeIn(tween(200)),
        exit = slideOutVertically(tween(280)) { it } + fadeOut(tween(220)),
    ) { PlayerBody(nav, pl) }
}

@Composable
private fun PlayerBody(nav: Nav, pl: Player) {
    val p = LocalPal.current
    val t = pl.track ?: return
    val dy = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current

    Box(
        Modifier
            .fillMaxSize()
            .offset { IntOffset(0, dy.value.roundToInt()) }
            .background(p.bg)
            .absorb()
            .pointerInput(Unit) {
                detectVerticalDragGestures(
                    onDragEnd = { scope.launch { if (dy.value > with(density) { 140.dp.toPx() }) { nav.player = false; dy.snapTo(0f) } else dy.animateTo(0f) } },
                ) { _, d -> scope.launch { dy.snapTo((dy.value + d).coerceAtLeast(0f)) } }
            },
    ) {
        // размытая обложка — фон (на Android 12+; раньше — просто палитра трека)
        if (Build.VERSION.SDK_INT >= 31) {
            Img(t.cover, Modifier.fillMaxSize().blur(70.dp), 200, RoundedCornerShape(0.dp), ContentScale.Crop)
            Box(Modifier.fillMaxSize().background(p.bg.copy(alpha = 0.72f)))
        }
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(p.accent.copy(alpha = 0.12f), Color.Transparent, p.bg.copy(alpha = 0.6f)))))

        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconBtn(AIcons.chevronL, Modifier.graphicsLayer { rotationZ = -90f }) { nav.player = false }
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Txt(topLine(pl), T.tiny, p.text2, maxLines = 1)
                    if (pl.via.isNotEmpty()) Txt(pl.via, T.small, p.text3, maxLines = 1)
                }
                IconBtn(AIcons.more) { Engine.send("modes") }
            }

            // пластинка с кольцом перемотки
            BoxWithConstraints(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                val side = minOf(maxWidth, maxHeight) - 24.dp
                SeekDisc(pl, Modifier.size(side))
            }

            Column(Modifier.padding(horizontal = 24.dp)) {
                Marquee(t.title, T.h1, p.text)
                Spacer(Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Txt(t.artist.ifEmpty { "Исполнитель неизвестен" }, T.bodyM, p.text2, Modifier.weight(1f).press {
                        if (t.artist.isNotEmpty()) { Engine.send("artist", t.artist.split(",").first().trim()); nav.library("artists") }
                    }, maxLines = 1)
                    if (t.source != "sc") IconBtn(AIcons.soundcloud, tint = p.text2) { Engine.send("findSc"); nav.library() }
                    IconBtn(AIcons.albumAdd, tint = p.text2) { Engine.send("addToAlbum") }
                }
                Chips(pl, nav)
            }

            // управление
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                IconBtn(AIcons.shuffle, tint = if (pl.shuffle) p.accent else p.text3) { Engine.send("shuffle") }
                IconBtn(AIcons.prev, size = 56.dp, iconSize = 30.dp) { Engine.send("prev") }
                Box(Modifier.size(82.dp).clip(CircleShape).background(p.accent).press { Engine.send("toggle") }, contentAlignment = Alignment.Center) {
                    Ico(if (pl.playing) AIcons.pause else AIcons.play, p.onAccent, 36.dp)
                }
                IconBtn(AIcons.next, size = 56.dp, iconSize = 30.dp) { Engine.send("next") }
                Box {
                    IconBtn(AIcons.repeat, tint = if (pl.repeat != "off") p.accent else p.text3) { Engine.send("repeat") }
                    if (pl.repeat == "one") Txt("1", T.tiny, p.accent, Modifier.align(Alignment.TopEnd).padding(top = 6.dp, end = 8.dp))
                }
            }

            // нижний ряд: текст, очередь, бочка, вместе, эквалайзер
            Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 8.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Tool(AIcons.lyrics, "текст") { nav.lyrics = true }
                Tool(AIcons.list, "очередь") { nav.queue = true }
                BarrelTool(pl)
                Tool(AIcons.together, if (pl.room != null) "рума" else "вместе", on = pl.room != null) { Engine.send("together") }
                Tool(AIcons.eq, "звук") { nav.eq = true }
            }
            // громкость плеера (как ползунок на компьютере; кнопки телефона — общая громкость)
            Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                IconBtn(if (pl.muted || pl.volume == 0.0) AIcons.mute else AIcons.vol, tint = p.text2, size = 38.dp, iconSize = 20.dp) { Engine.send("mute") }
                var vol by remember(pl.volume) { mutableFloatStateOf(pl.volume.toFloat()) }
                Scrub(if (pl.muted) 0f else vol, Modifier.weight(1f).padding(end = 10.dp), p.text2, onInput = { vol = it; Engine.send("volume", it.toDouble(), false) }, onDone = { vol = it; Engine.send("volume", it.toDouble(), true) })
            }
            Spacer(Modifier.height(6.dp))
        }
    }
}

private fun topLine(pl: Player): String = when {
    pl.karaoke -> "караоке"
    pl.wave -> if (pl.dj) "волна · говорит диджей" else "волна"
    pl.room != null -> "рума ${pl.room.code}"
    else -> "сейчас играет"
}


/** Плашки состояния: таймер сна, фокус, бочка в звонке. Нажатие — то же, что на компьютере. */
@Composable
private fun Chips(pl: Player, nav: Nav) {
    val p = LocalPal.current
    val chips = buildList {
        if (pl.sleep != 0) add(Triple(AIcons.moon, if (pl.sleep < 0) "сон — до конца трека" else "сон через ${fmt(pl.sleep.toDouble())}", "sleep"))
        pl.focus?.let { f -> add(Triple(AIcons.focus, "${if (f.phase == "work") "фокус" else "перерыв"} ${fmt(f.left.toDouble())}${if (f.paused) " · пауза" else ""}", "focus")) }
        if (pl.call) add(Triple(AIcons.phone, if (pl.duckOn) "звонок · бочка включится" else "звонок · бочка выключена", "duck"))
    }
    if (chips.isEmpty()) return
    Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for ((icon, s, act) in chips) {
            Row(
                Modifier.clip(RoundedCornerShape(99.dp)).background(p.soft).press {
                    // как плашки на компьютере: сон — отменить, фокус — открыть панель
                    when (act) {
                        "duck" -> Engine.send("duckEnabled", !pl.duckOn)
                        "sleep" -> Engine.send("sleepCancel")
                        "focus" -> Engine.send("focusPanel")
                        else -> Engine.send("modes")
                    }
                }.padding(horizontal = 12.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Ico(icon, p.accent, 15.dp)
                Spacer(Modifier.width(6.dp))
                Txt(s, T.smallM, p.text, maxLines = 1)
            }
        }
    }
}

@Composable
private fun Tool(icon: androidx.compose.ui.graphics.vector.ImageVector, s: String, on: Boolean = false, onClick: () -> Unit) {
    val p = LocalPal.current
    Column(Modifier.press(onClick = onClick).padding(horizontal = 6.dp, vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(44.dp).clip(CircleShape).background(if (on) p.voice else p.soft), contentAlignment = Alignment.Center) { Ico(icon, if (on) p.onVoice else p.text, 21.dp) }
        Spacer(Modifier.height(4.dp))
        Txt(s, T.tiny, p.text2)
    }
}

/** Бочка вручную: обруч вокруг кнопки заполняется силой эффекта. Долгое нажатие — вкл/выкл бочку в звонке. */
@Composable
private fun BarrelTool(pl: Player) {
    val p = LocalPal.current
    Column(
        Modifier.press(onLong = { Engine.send("duckEnabled", !pl.duckOn) }) { Engine.send("barrel") }.padding(horizontal = 6.dp, vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) {
            Canvas(Modifier.fillMaxSize()) {
                drawCircle(if (pl.manual) p.voice else p.soft)
                if (pl.barrel > 0.01f) drawArc(p.voice, -90f, 360f * pl.barrel, false, style = Stroke(3.dp.toPx(), cap = StrokeCap.Round), topLeft = Offset(2.dp.toPx(), 2.dp.toPx()), size = Size(size.width - 4.dp.toPx(), size.height - 4.dp.toPx()))
            }
            Txt("🛢", T.body, p.text)
        }
        Spacer(Modifier.height(4.dp))
        Txt(if (pl.barrel > 0.5f) "в бочке" else "бочка", T.tiny, if (pl.barrel > 0.5f) p.voice else p.text2)
    }
}

/** Пластинка, вокруг — кольцо перемотки: тянешь пальцем по кругу — перематываешь. */
@Composable
private fun SeekDisc(pl: Player, modifier: Modifier) {
    val p = LocalPal.current
    val pos = rememberPos(pl)
    var drag by remember { mutableStateOf<Float?>(null) }
    var held by remember { mutableStateOf(false) }
    var hand by remember { mutableFloatStateOf(0f) }
    val frac = drag ?: if (pl.dur > 0) (pos / pl.dur).toFloat() else 0f
    Box(modifier, contentAlignment = Alignment.Center) {
        Canvas(
            Modifier
                .fillMaxSize()
                .pointerInput(pl.dur) {
                    fun deg(o: Offset) = Math.toDegrees(atan2((o.y - size.height / 2f).toDouble(), (o.x - size.width / 2f).toDouble())).toFloat()
                    fun angleFrac(o: Offset): Float = ((((deg(o) + 90f) / 360f) % 1f) + 1f) % 1f
                    var lastDeg = 0f
                    var lastT = 0L
                    // за кольцо — перемотка, за саму пластинку — скретч (как на компьютере)
                    detectDragGestures(
                        onDragStart = { o ->
                            val r = hypot(o.x - size.width / 2f, o.y - size.height / 2f)
                            if (r > size.width * 0.44f) drag = angleFrac(o)
                            else if (pl.track != null) {
                                held = true
                                lastDeg = deg(o)
                                lastT = System.currentTimeMillis()
                                Engine.send("scratchStart")
                            }
                        },
                        onDragEnd = {
                            drag?.let { Engine.send("seek", it * pl.dur) }
                            drag = null
                            if (held) { held = false; Engine.send("scratchEnd") }
                        },
                        onDragCancel = {
                            drag = null
                            if (held) { held = false; Engine.send("scratchEnd") }
                        },
                    ) { ch, _ ->
                        ch.consume()
                        if (drag != null) drag = angleFrac(ch.position)
                        else if (held) {
                            val a = deg(ch.position)
                            val d = ((a - lastDeg + 540f) % 360f) - 180f
                            val now = System.currentTimeMillis()
                            hand += d
                            Engine.send("scratchMove", d, now - lastT)
                            lastDeg = a
                            lastT = now
                        }
                    }
                },
        ) {
            val stroke = 5.dp.toPx()
            val inset = stroke * 2
            val arcSize = Size(size.width - inset * 2, size.height - inset * 2)
            drawArc(p.line.copy(alpha = 0.6f), 0f, 360f, false, Offset(inset, inset), arcSize, style = Stroke(stroke))
            drawArc(p.accent, -90f, 360f * clamp01(frac), false, Offset(inset, inset), arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
            val a = (-90f + 360f * clamp01(frac)) * (Math.PI / 180).toFloat()
            val r = arcSize.width / 2
            drawCircle(p.text, if (drag != null) 11.dp.toPx() else 7.dp.toPx(), Offset(center.x + cos(a) * r, center.y + sin(a) * r))
        }
        Disc(pl.track, pl.playing, Modifier.fillMaxSize(0.86f), pl.barrel, labelSize = 720, held = held, hand = hand)
        // время — под кольцом
        Row(Modifier.align(Alignment.BottomCenter).offset(y = 8.dp)) {
            Txt(fmt(if (drag != null) drag!! * pl.dur else pos), T.num, if (drag != null) p.accent else p.text2)
            Txt(" / ${fmt(pl.dur)}", T.num, p.text3)
        }
    }
}
