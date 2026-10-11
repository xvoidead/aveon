@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)

package com.aveon.player.ui

import android.os.Build
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.combinedClickable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.aveon.player.Engine
import com.aveon.player.Player
import com.aveon.player.Track
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

private val W60 = Color.White.copy(alpha = 0.6f)
private val W45 = Color.White.copy(alpha = 0.45f)
private val W15 = Color.White.copy(alpha = 0.15f)

/**
 * Раскрытый плеер. Выезжает из мини-плеера, обложка «перелетает» из него на своё место (FlyingArt).
 * Режимы как в Apple Music: обложка, текст (обложка сжимается в шапку), очередь.
 */
@Composable
fun PlayerLayer(nav: Nav) {
    val pl by Engine.player.collectAsState()
    val t = pl.track ?: return
    val k = nav.expand.value.coerceIn(0f, 1f)
    if (k <= 0f) return
    val d = LocalDensity.current
    val scope = rememberCoroutineScope()
    val haptic = LocalHapticFeedback.current
    val mk by animateFloatAsState(if (nav.mode == PMode.Art) 0f else 1f, spring(dampingRatio = 0.84f, stiffness = 300f), label = "mode")
    val ps by animateFloatAsState(if (pl.playing) 1f else 0.78f, spring(dampingRatio = 0.62f, stiffness = 240f), label = "pauseScale")
    val artDx = remember { Animatable(0f) }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wPx = constraints.maxWidth.toFloat()
        val hPx = constraints.maxHeight.toFloat()
        val top = WindowInsets.statusBars.getTop(d).toFloat()
        val bottom = WindowInsets.navigationBars.getBottom(d).toFloat()
        val artSide: Dp = with(d) { min(wPx - 56.dp.toPx(), hPx - top - bottom - 392.dp.toPx()).coerceAtLeast(150.dp.toPx()).toDp() }
        val sheetY = (1f - k) * hPx
        val head = 30.dp
        val corner = with(d) { (lerp(36f, 0f, ((k - 0.85f) / 0.15f).coerceIn(0f, 1f))).dp }

        // --- лист плеера ---
        Box(
            Modifier
                .fillMaxSize()
                // палец ловим до сдвига листа (graphicsLayer ниже): иначе лист уезжает из-под пальца и дрожит
                .pointerInput(artSide) {
                    // тянешь вниз — плеер сворачивается за пальцем; по обложке влево/вправо — другой трек
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        val vt = VelocityTracker()
                        vt.addPosition(down.uptimeMillis, down.position)
                        var axis = 0
                        var total = Offset.Zero
                        var last = down.position
                        val artTop = top + head.toPx()
                        val onArt = nav.mode == PMode.Art && down.position.y in artTop..(artTop + artSide.toPx() + 12.dp.toPx())
                        val canDrag = nav.mode == PMode.Art || down.position.y < top + head.toPx() + 82.dp.toPx()
                        while (true) {
                            val ev = awaitPointerEvent()
                            val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                            if (!ch.pressed) break
                            val delta = ch.position - last
                            last = ch.position
                            if (ch.isConsumed && axis == 0) { axis = -1 }
                            if (axis == -1) continue
                            total += delta
                            vt.addPosition(ch.uptimeMillis, ch.position)
                            if (axis == 0 && total.getDistance() > viewConfiguration.touchSlop) {
                                axis = when {
                                    abs(total.x) > abs(total.y) * 1.2f && onArt -> 1
                                    total.y > 0 && abs(total.y) > abs(total.x) && canDrag -> 2
                                    else -> -1
                                }
                            }
                            if (axis == 1) { ch.consume(); scope.launch { artDx.snapTo(artDx.value + delta.x) } }
                            if (axis == 2) { ch.consume(); scope.launch { nav.expand.snapTo((nav.expand.value - delta.y / hPx).coerceIn(0f, 1f)) } }
                        }
                        val v = vt.calculateVelocity()
                        when (axis) {
                            1 -> scope.launch {
                                val fling = abs(v.x) > 1100f
                                val dir = if (abs(artDx.value) > wPx * 0.25f || fling) (if ((if (fling) v.x else artDx.value) < 0) 1 else -1) else 0
                                if (dir != 0) {
                                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                    artDx.animateTo(-dir * wPx, tween(170))
                                    Engine.send(if (dir > 0) "next" else "prev")
                                    artDx.snapTo(dir * wPx * 0.7f)
                                }
                                artDx.animateTo(0f, spring(dampingRatio = 0.8f, stiffness = 300f))
                            }
                            2 -> nav.settle(v.y)
                        }
                    }
                }
                .graphicsLayer { translationY = sheetY; shape = RoundedCornerShape(corner); clip = true },
        ) {
            PlayerBackground(t, pl.playing)
            Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().graphicsLayer { alpha = ((k - 0.35f) / 0.5f).coerceIn(0f, 1f) }) {
                // ручка и откуда играет
                Column(Modifier.fillMaxWidth().height(head).tap { nav.closePlayer() }, horizontalAlignment = Alignment.CenterHorizontally) {
                    Spacer(Modifier.height(7.dp))
                    Box(Modifier.size(width = 38.dp, height = 5.dp).clip(CircleShape).background(W45))
                    Spacer(Modifier.height(3.dp))
                    Txt(topLine(pl), A.caption, if (pl.karaoke) LocalPal.current.accent else W60, maxLines = 1)
                }
                // шапка: в режиме обложки — место под большую обложку, в тексте/очереди — маленькая обложка и название
                Box(Modifier.fillMaxWidth().height(lerpDp(artSide + 22.dp, 76.dp, mk))) {
                    if (mk > 0.02f) Row(
                        Modifier.fillMaxSize().padding(start = 96.dp, end = 12.dp).graphicsLayer { alpha = mk; translationY = (1 - mk) * 30f }
                            .tap { if (pl.karaoke) Engine.send("karaokeOff"); nav.mode = PMode.Art },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Marquee(t.title, A.headline, Color.White)
                            Txt(t.artist.ifEmpty { "Исполнитель неизвестен" }, A.subhead, W60, maxLines = 1)
                        }
                        CircleBtn(G.ellipsis) { Engine.send("modes") }
                    }
                }
                // середина
                Box(Modifier.fillMaxWidth().weight(1f)) {
                    AnimatedContent(
                        nav.mode,
                        transitionSpec = { fadeIn(tween(260, 90)) togetherWith fadeOut(tween(140)) },
                        label = "pmode",
                    ) { m ->
                        when (m) {
                            PMode.Art -> Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center) {
                                TitleRow(pl, t, nav)
                                StatusChips(pl)
                            }
                            PMode.Lyrics -> LyricsView(pl, Modifier.fillMaxSize())
                            PMode.Queue -> QueueView(pl, nav)
                        }
                    }
                }
                // управление (в тексте прячется, пока не коснёшься)
                var shown by remember { mutableStateOf(true) }
                var poke by remember { mutableIntStateOf(0) }
                LaunchedEffect(nav.mode, poke, pl.playing) {
                    shown = true
                    if (nav.mode == PMode.Lyrics && pl.playing) { delay(4500); shown = false }
                }
                if (!shown) Box(Modifier.fillMaxWidth().height(28.dp).tap { poke++ })
                AnimatedVisibility(shown, enter = expandVertically(spring(dampingRatio = 0.9f, stiffness = 380f)) + fadeIn(), exit = shrinkVertically(tween(320)) + fadeOut(tween(200))) {
                    Column {
                        SeekBar(pl)
                        Transport(pl)
                        VolumeRow(pl)
                    }
                }
                BottomTools(pl, nav)
            }
        }

        // --- обложка в полёте ---
        val mini = nav.miniArt
        val bigS = with(d) { artSide.toPx() }
        val big = Rect(Offset((wPx - bigS) / 2f, top + with(d) { (head + 11.dp).toPx() }), Size(bigS, bigS))
        val smallS = with(d) { 64.dp.toPx() }
        val small = Rect(Offset(with(d) { 20.dp.toPx() }, top + with(d) { (head + 6.dp).toPx() }), Size(smallS, smallS))
        var target = lerpRect(big, small, mk)
        // пауза — обложка «отступает»; к шапке — масштаб уже не нужен
        val s = lerp(ps, 1f, mk)
        target = Rect(target.center - Offset(target.width * s / 2, target.height * s / 2), Size(target.width * s, target.height * s))
        target = target.translate(artDx.value, sheetY)
        val r = if (mini == Rect.Zero) target else lerpRect(mini, target, k)
        val rad = lerp(lerp(with(d) { 8.dp.toPx() }, with(d) { 11.dp.toPx() }, k), with(d) { 7.dp.toPx() }, mk)
        Box(
            Modifier
                .offset { IntOffset(r.left.roundToInt(), r.top.roundToInt()) }
                .size(with(d) { r.width.toDp() }, with(d) { r.height.toDp() })
                .graphicsLayer {
                    shadowElevation = 34.dp.toPx() * k * (1 - mk) * s
                    shape = RoundedCornerShape(rad)
                    clip = true
                    alpha = 1f - (abs(artDx.value) / wPx).coerceIn(0f, 0.7f)
                },
        ) { Cover(t, Modifier.fillMaxSize(), 900, RectangleShape) }
    }
}

private fun lerpDp(a: Dp, b: Dp, k: Float): Dp = a + (b - a) * k
private fun lerpRect(a: Rect, b: Rect, k: Float) = Rect(lerp(a.left, b.left, k), lerp(a.top, b.top, k), lerp(a.right, b.right, k), lerp(a.bottom, b.bottom, k))

private fun topLine(pl: Player): String = when {
    pl.karaoke -> "КАРАОКЕ"
    pl.wave -> if (pl.dj) "Волна · говорит диджей" else "Волна"
    pl.room != null -> "Слушаете вместе · ${pl.room.code}"
    pl.via.isNotEmpty() -> pl.via
    else -> ""
}

// ---------- фон: живые цвета обложки ----------
// Как в Apple Music: размытая обложка и медленно плывущие пятна её цветов.

@Composable
fun PlayerBackground(t: Track?, playing: Boolean) {
    val art = LocalArt.current
    val tr = rememberInfiniteTransition(label = "bg")
    val ph by tr.animateFloat(0f, TAU, infiniteRepeatable(tween(26000, easing = LinearEasing)), label = "ph")
    val spin by tr.animateFloat(0f, 360f, infiniteRepeatable(tween(60000, easing = LinearEasing)), label = "spin")
    Box(Modifier.fillMaxSize().background(art.bg.mix(Color.Black, 0.35f))) {
        if (Build.VERSION.SDK_INT >= 31 && t != null) {
            Img(
                t.cover,
                Modifier.fillMaxSize().graphicsLayer { scaleX = 2.2f; scaleY = 2.2f; rotationZ = spin; alpha = 0.9f }.blur(80.dp),
                120, RectangleShape, ContentScale.Crop,
            )
        }
        Canvas(Modifier.fillMaxSize()) {
            val w = size.width; val h = size.height
            fun blob(c: Color, cx: Float, cy: Float, r: Float) =
                drawCircle(Brush.radialGradient(listOf(c, c.copy(alpha = 0f)), Offset(cx, cy), r), r, Offset(cx, cy))
            blob(art.accent.copy(alpha = 0.45f), w * (0.3f + 0.25f * sin(ph)), h * (0.25f + 0.12f * cos(ph * 2)), w * 0.9f)
            blob(art.voice.copy(alpha = 0.3f), w * (0.75f + 0.2f * cos(ph + 1f)), h * (0.6f + 0.15f * sin(ph * 2 + 2f)), w * 0.85f)
            blob(art.surface.copy(alpha = 0.55f), w * (0.5f + 0.3f * sin(ph * 3 + 4f)), h * (0.92f + 0.05f * cos(ph)), w)
        }
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.12f), Color.Black.copy(alpha = 0.28f), Color.Black.copy(alpha = 0.5f)))))
    }
}

// ---------- название, кнопки рядом ----------

@Composable
private fun TitleRow(pl: Player, t: Track, nav: Nav) {
    Row(Modifier.fillMaxWidth().padding(start = 28.dp, end = 20.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            AnimatedContent(t.id, transitionSpec = { (fadeIn(tween(300)) togetherWith fadeOut(tween(150))) }, label = "title") { _ ->
                Column {
                    Marquee(t.title, A.title3, Color.White)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (t.explicit) { Explicit(W60); Spacer(Modifier.width(6.dp)) }
                        Txt(
                            t.artist.ifEmpty { "Исполнитель неизвестен" }, A.title3.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Normal), W60,
                            Modifier.press(scale = 0.97f) {
                                if (t.artist.isNotEmpty()) { Engine.send("artist", t.artist.split(",").first().trim()); nav.library("artists") }
                            },
                            maxLines = 1,
                        )
                    }
                }
            }
        }
        if (pl.wave) {
            CircleBtn(G.heart) { Engine.send("waveLike") }
            Spacer(Modifier.width(10.dp))
            CircleBtn(G.heartSlash) { Engine.send("waveDislike") }
        } else {
            if (t.source != "sc") { CircleBtn(AIcons.soundcloud) { Engine.send("findSc"); nav.library() }; Spacer(Modifier.width(10.dp)) }
            CircleBtn(G.plus) { Engine.send("addToAlbum") }
        }
        Spacer(Modifier.width(10.dp))
        CircleBtn(G.ellipsis) { Engine.send("modes") }
    }
}

/** Кружок с полупрозрачной белой заливкой — как «★» и «…» в плеере Apple Music. */
@Composable
private fun CircleBtn(icon: ImageVector, on: Boolean = false, onClick: () -> Unit) {
    Box(
        Modifier.size(32.dp).press(scale = 0.86f, onClick = onClick).clip(CircleShape).background(if (on) Color.White else W15),
        contentAlignment = Alignment.Center,
    ) { Ico(icon, if (on) Color.Black else Color.White, 17.dp) }
}

/** Плашки состояния: таймер сна, фокус, бочка в звонке. */
@Composable
private fun StatusChips(pl: Player) {
    val p = LocalPal.current
    val chips = buildList {
        if (pl.sleep != 0) add(Triple(AIcons.moon, if (pl.sleep < 0) "Сон — до конца трека" else "Сон через ${fmt(pl.sleep.toDouble())}", "sleep"))
        pl.focus?.let { f -> add(Triple(AIcons.focus, "${if (f.phase == "work") "Фокус" else "Перерыв"} ${fmt(f.left.toDouble())}${if (f.paused) " · пауза" else ""}", "focus")) }
        if (pl.call) add(Triple(AIcons.phone, if (pl.duckOn) "Звонок · бочка включится" else "Звонок · бочка выключена", "duck"))
    }
    if (chips.isEmpty()) return
    Row(Modifier.padding(start = 28.dp, top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for ((icon, s, act) in chips) {
            Row(
                Modifier.clip(CircleShape).background(W15).press {
                    when (act) {
                        "duck" -> Engine.send("duckEnabled", !pl.duckOn)
                        "sleep" -> Engine.send("sleepCancel")
                        "focus" -> Engine.send("focusPanel")
                    }
                }.padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Ico(icon, p.accent, 14.dp)
                Spacer(Modifier.width(6.dp))
                Txt(s, A.footnoteM, Color.White, maxLines = 1)
            }
        }
    }
}

// ---------- перемотка ----------

@Composable
private fun SeekBar(pl: Player) {
    val pos = rememberPos(pl)
    var preview by remember { mutableStateOf<Float?>(null) }
    var doneAt by remember { mutableLongStateOf(0L) }
    var dragging by remember { mutableStateOf(false) }
    // после перемотки держим новое место, пока движок не пришлёт свежую позицию
    LaunchedEffect(doneAt) { if (doneAt > 0) { delay(900); if (!dragging) preview = null } }
    val f = preview ?: if (pl.dur > 0) (pos / pl.dur).toFloat() else 0f
    val shownPos = if (preview != null) preview!! * pl.dur else pos
    val lift by animateFloatAsState(if (dragging) 1f else 0f, spring(dampingRatio = 0.6f, stiffness = 500f), label = "lift")
    Column(Modifier.fillMaxWidth().padding(horizontal = 28.dp)) {
        Scrub(
            f, Modifier.fillMaxWidth(), Color.White, Color.White.copy(alpha = 0.22f), 7.dp,
            onInput = { dragging = true; preview = it },
            onDone = { dragging = false; preview = it; doneAt = System.currentTimeMillis(); Engine.send("seek", it * pl.dur) },
        )
        Row(Modifier.fillMaxWidth().graphicsLayer { translationY = lift * 6.dp.toPx() }, verticalAlignment = Alignment.CenterVertically) {
            Txt(fmt(shownPos), A.num, if (dragging) Color.White else W45)
            Spacer(Modifier.weight(1f))
            val badge = pl.track?.let { t -> if (t.preview) "30 СЕКУНД" else SOURCE_SHORT[t.source]?.uppercase() } ?: ""
            if (badge.isNotEmpty()) Box(Modifier.clip(RoundedCornerShape(4.dp)).background(Color.White.copy(alpha = 0.1f)).padding(horizontal = 6.dp, vertical = 2.dp)) {
                Txt(badge, A.tab, W60)
            }
            Spacer(Modifier.weight(1f))
            Txt("-" + fmt((pl.dur - shownPos).coerceAtLeast(0.0)), A.num, if (dragging) Color.White else W45)
        }
    }
}

// ---------- назад · играть · вперёд ----------

@Composable
private fun Transport(pl: Player) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 30.dp, vertical = 10.dp), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
        SkipBtn(G.backward, -1, pl)
        BigPlay(pl.playing)
        SkipBtn(G.forward, 1, pl)
    }
}

@Composable
private fun BigPlay(playing: Boolean) {
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val bg by animateFloatAsState(if (pressed) 0.14f else 0f, tween(if (pressed) 60 else 300), label = "ppbg")
    val sc by animateFloatAsState(if (pressed) 0.86f else 1f, spring(dampingRatio = 0.5f, stiffness = 700f), label = "ppsc")
    Box(
        Modifier.size(86.dp).clip(CircleShape).background(Color.White.copy(alpha = bg))
            .combinedClickable(src, null) { Engine.send("toggle") },
        contentAlignment = Alignment.Center,
    ) {
        AnimatedContent(
            playing,
            transitionSpec = {
                (androidx.compose.animation.scaleIn(spring(dampingRatio = 0.55f, stiffness = 500f), initialScale = 0.3f) + fadeIn(tween(120))) togetherWith
                    (androidx.compose.animation.scaleOut(tween(140), targetScale = 0.3f) + fadeOut(tween(110)))
            },
            modifier = Modifier.graphicsLayer { scaleX = sc; scaleY = sc },
            label = "bigpp",
        ) { on -> Ico(if (on) G.pause else G.play, Color.White, 50.dp) }
    }
}

/** «Вперёд/назад»: нажатие подсвечивает кружок, значок толкается в сторону. Подержать — перемотка на 10 с. */
@Composable
private fun SkipBtn(icon: ImageVector, dir: Int, pl: Player) {
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val bg by animateFloatAsState(if (pressed) 0.14f else 0f, tween(if (pressed) 60 else 320), label = "skbg")
    val nudge = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    val haptic = LocalHapticFeedback.current
    Box(
        Modifier.size(70.dp).clip(CircleShape).background(Color.White.copy(alpha = bg))
            .combinedClickable(
                src, null,
                onLongClick = {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    Engine.send("seek", (pl.posNow() + dir * 10).coerceAtLeast(0.0))
                },
            ) {
                scope.launch { nudge.snapTo(0f); nudge.animateTo(1f, tween(110)); nudge.animateTo(0f, spring(dampingRatio = 0.5f, stiffness = 500f)) }
                Engine.send(if (dir > 0) "next" else "prev")
            },
        contentAlignment = Alignment.Center,
    ) {
        Ico(icon, Color.White, 38.dp, Modifier.graphicsLayer { translationX = nudge.value * dir * 7.dp.toPx(); val s = 1f - nudge.value * 0.12f; scaleX = s; scaleY = s })
    }
}

// ---------- громкость ----------

@Composable
private fun VolumeRow(pl: Player) {
    var vol by remember(pl.volume) { mutableFloatStateOf(pl.volume.toFloat()) }
    Row(Modifier.fillMaxWidth().padding(horizontal = 28.dp), verticalAlignment = Alignment.CenterVertically) {
        Ico(G.speakerLow, W45, 14.dp, Modifier.tap { Engine.send("mute") })
        Spacer(Modifier.width(10.dp))
        Scrub(
            if (pl.muted) 0f else vol, Modifier.weight(1f), Color.White, Color.White.copy(alpha = 0.22f), 7.dp,
            onInput = { vol = it; Engine.send("volume", it.toDouble(), false) },
            onDone = { vol = it; Engine.send("volume", it.toDouble(), true) },
        )
        Spacer(Modifier.width(10.dp))
        Ico(G.speakerHigh, W45, 18.dp)
    }
}

// ---------- нижний ряд: текст, вместе, бочка, звук, очередь ----------

@Composable
private fun BottomTools(pl: Player, nav: Nav) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 30.dp, vertical = 10.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Tool(G.lyrics, nav.mode == PMode.Lyrics) {
            if (nav.mode == PMode.Lyrics) { if (pl.karaoke) Engine.send("karaokeOff"); nav.mode = PMode.Art } else nav.mode = PMode.Lyrics
        }
        Tool(AIcons.together, pl.room != null, LocalPal.current.voice) { Engine.send("together") }
        BarrelTool(pl)
        Tool(AIcons.eq, false) { nav.eq = true }
        Tool(G.queue, nav.mode == PMode.Queue) { nav.mode = if (nav.mode == PMode.Queue) PMode.Art else PMode.Queue }
    }
}

@Composable
private fun Tool(icon: ImageVector?, on: Boolean, onColor: Color = Color.White, onClick: () -> Unit) {
    val bg by animateFloatAsState(if (on) 1f else 0f, spring(dampingRatio = 0.7f, stiffness = 500f), label = "tool")
    Box(
        Modifier.size(42.dp).press(scale = 0.86f, onClick = onClick).clip(RoundedCornerShape(10.dp)).background(onColor.copy(alpha = 0.92f * bg.coerceIn(0f, 1f))),
        contentAlignment = Alignment.Center,
    ) { Ico(icon, W60.mix(Color(0xFF1A1A1A), bg), 22.dp) }
}

/** Бочка: обруч вокруг заполняется силой эффекта. Подержать — бочка в звонке вкл/выкл. */
@Composable
private fun BarrelTool(pl: Player) {
    val p = LocalPal.current
    val on = pl.manual
    Box(
        Modifier.size(42.dp).press(onLong = { Engine.send("duckEnabled", !pl.duckOn) }, scale = 0.86f) { Engine.send("barrel") },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.fillMaxSize()) {
            if (on) drawRoundRect(p.voice.copy(alpha = 0.9f), cornerRadius = androidx.compose.ui.geometry.CornerRadius(10.dp.toPx()))
            if (pl.barrel > 0.01f) drawArc(
                p.voice, -90f, 360f * pl.barrel, false, Offset(4.dp.toPx(), 4.dp.toPx()), Size(size.width - 8.dp.toPx(), size.height - 8.dp.toPx()),
                style = Stroke(2.5.dp.toPx(), cap = StrokeCap.Round),
            )
        }
        Txt("🛢", A.callout, Color.White)
    }
}

// ---------- очередь ----------

@Composable
private fun QueueView(pl: Player, nav: Nav) {
    val p = LocalPal.current
    var list by remember { mutableStateOf<List<Track>>(emptyList()) }
    var pos by remember { mutableIntStateOf(-1) }
    val state = rememberLazyListState()
    LaunchedEffect(pl.track?.id) {
        Engine.obj("queue")?.let { o ->
            list = Track.list(o.optJSONArray("tracks"))
            pos = o.optInt("pos", -1)
            // прошлое — выше: листаешь вверх, видишь историю
            if (pos > 0) state.scrollToItem(pos + 1)
        }
    }
    LazyColumn(Modifier.fillMaxSize(), state = state, contentPadding = PaddingValues(bottom = 12.dp)) {
        item {
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                QueueToggle(AIcons.shuffle, "", pl.shuffle, Modifier.weight(1f)) { Engine.send("shuffle") }
                QueueToggle(AIcons.repeat, if (pl.repeat == "one") "1" else "", pl.repeat != "off", Modifier.weight(1f)) { Engine.send("repeat") }
                QueueToggle(G.radio, "", pl.wave, Modifier.weight(1f)) { Engine.send("waveGo") }
            }
        }
        itemsIndexed(list, key = { i, t -> "$i:${t.id}" }) { i, t ->
            if (i == pos + 1 || (i == 0 && pos < 0)) QueueHead(if (pl.wave) "Дальше в волне" else "Далее", pl.via)
            if (i == pos) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Txt("Сейчас играет", A.footnoteM, W45)
                }
            }
            val past = i < pos
            Row(
                Modifier.fillMaxWidth().graphicsLayer { alpha = if (past) 0.45f else 1f }
                    .press(scale = 0.98f) { Engine.send("queuePlay", i); pos = i }
                    .padding(horizontal = 20.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(44.dp)) {
                    Cover(t, Modifier.fillMaxSize(), 140, RoundedCornerShape(6.dp))
                    if (i == pos) Box(Modifier.fillMaxSize().clip(RoundedCornerShape(6.dp)).background(Color.Black.copy(alpha = 0.4f)), contentAlignment = Alignment.Center) { EqBars(pl.playing, Color.White) }
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Txt(t.title, A.callout, if (i == pos) p.accent.mix(Color.White, 0.3f) else Color.White, maxLines = 1)
                    Txt(t.artist, A.footnote, W60, maxLines = 1)
                }
                if (t.duration > 0) Txt(fmt(t.duration), A.num, W45)
            }
        }
        if (list.isEmpty()) item { Txt("Очередь пуста", A.subhead, W60, Modifier.padding(20.dp)) }
    }
}

@Composable
private fun QueueHead(title: String, via: String) {
    Column(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 6.dp)) {
        Txt(title, A.headline, Color.White)
        if (via.isNotEmpty()) Txt(via, A.footnote, W60, maxLines = 1)
    }
}

/** Большие кнопки над очередью (в iOS 18 их сделали крупными): перемешать, повтор, волна. */
@Composable
private fun QueueToggle(icon: ImageVector?, badge: String, on: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val k by animateFloatAsState(if (on) 1f else 0f, spring(dampingRatio = 0.7f, stiffness = 500f), label = "qt")
    Box(
        modifier.height(36.dp).press(scale = 0.94f, onClick = onClick).clip(RoundedCornerShape(10.dp)).background(Color.White.copy(alpha = 0.14f + 0.78f * k.coerceIn(0f, 1f))),
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Ico(icon, Color.White.mix(Color(0xFF1A1A1A), k), 19.dp)
            if (badge.isNotEmpty()) Txt(badge, A.footnoteM, Color.White.mix(Color(0xFF1A1A1A), k), Modifier.padding(start = 2.dp))
        }
    }
}
