package com.aveon.player.ui

import android.graphics.Bitmap
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.composed
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.aveon.player.Images
import com.aveon.player.Track
import androidx.compose.foundation.text.BasicText
import kotlin.math.PI
import kotlin.math.max
import kotlin.math.min

// ---------- текст ----------

@Composable
fun Txt(
    s: String,
    style: TextStyle = T.body,
    color: Color = LocalPal.current.text,
    modifier: Modifier = Modifier,
    maxLines: Int = Int.MAX_VALUE,
    weight: FontWeight? = null,
) {
    BasicText(
        text = s,
        modifier = modifier,
        style = if (weight != null) style.copy(color = color, fontWeight = weight) else style.copy(color = color),
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
    )
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun Marquee(s: String, style: TextStyle, color: Color = LocalPal.current.text, modifier: Modifier = Modifier) {
    BasicText(s, modifier = modifier.basicMarquee(iterations = Int.MAX_VALUE, initialDelayMillis = 1800), style = style.copy(color = color), maxLines = 1)
}

// ---------- значки ----------

@Composable
fun Ico(icon: ImageVector?, tint: Color = LocalPal.current.text, size: Dp = 22.dp, modifier: Modifier = Modifier) {
    if (icon == null) { Spacer(modifier.size(size)); return }
    Image(painter = rememberVectorPainter(icon), contentDescription = null, colorFilter = ColorFilter.tint(tint), modifier = modifier.size(size))
}

// ---------- нажатия: вместо ряби — лёгкое «вдавливание» ----------

@OptIn(ExperimentalFoundationApi::class)
fun Modifier.press(enabled: Boolean = true, onLong: (() -> Unit)? = null, onClick: () -> Unit): Modifier = this.then(
    Modifier.pressImpl(enabled, onLong, onClick),
)

@OptIn(ExperimentalFoundationApi::class)
private fun Modifier.pressImpl(enabled: Boolean, onLong: (() -> Unit)?, onClick: () -> Unit): Modifier = composed {
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val k by animateFloatAsState(if (pressed) 0.95f else 1f, spring(stiffness = 900f), label = "press")
    val haptic = LocalHapticFeedback.current
    this
        .graphicsLayer { scaleX = k; scaleY = k }
        .combinedClickable(
            interactionSource = src,
            indication = null,
            enabled = enabled,
            onLongClick = onLong?.let { { haptic.performHapticFeedback(HapticFeedbackType.LongPress); it() } },
            onClick = onClick,
        )
}

/** Нажатие без анимации (затемнение под шторкой) и «поглотитель» нажатий (сама шторка). */
fun Modifier.tap(onClick: () -> Unit): Modifier = composed {
    clickable(remember { MutableInteractionSource() }, null, onClick = onClick)
}

fun Modifier.absorb(): Modifier = composed {
    clickable(remember { MutableInteractionSource() }, null) {}
}

// ---------- картинки ----------

@Composable
fun Img(
    url: String,
    modifier: Modifier = Modifier,
    size: Int = 320,
    shape: Shape = RoundedCornerShape(10.dp),
    scale: ContentScale = ContentScale.Crop,
    fallback: @Composable BoxScope.() -> Unit = {},
) {
    val ctx = LocalContext.current
    val bmp by produceState<Bitmap?>(Images.cached(url, size), url, size) {
        value = Images.cached(url, size)
        if (value == null) value = Images.load(ctx, url, size)
    }
    val p = LocalPal.current
    Box(modifier.clip(shape).background(p.soft), contentAlignment = Alignment.Center) {
        val b = bmp
        if (b != null) Image(b.asImageBitmap(), null, contentScale = scale, modifier = Modifier.fillMaxSize())
        else fallback()
    }
}

/** Обложка трека или первая буква названия. */
@Composable
fun Cover(t: Track?, modifier: Modifier, size: Int = 200, shape: Shape = RoundedCornerShape(10.dp)) {
    val p = LocalPal.current
    Img(t?.cover ?: "", modifier, size, shape) {
        Txt((t?.title?.trim()?.firstOrNull()?.uppercase() ?: "♪"), T.h3, p.text3)
    }
}

// ---------- кнопки ----------

@Composable
fun Pill(
    s: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    primary: Boolean = false,
    danger: Boolean = false,
    enabled: Boolean = true,
    small: Boolean = false,
    onClick: () -> Unit,
) {
    val p = LocalPal.current
    val bg = when { primary -> p.accent; else -> p.soft }
    val fg = when { primary -> p.onAccent; danger -> p.danger; else -> p.text }
    Row(
        modifier
            .graphicsLayer { alpha = if (enabled) 1f else 0.45f }
            .clip(RoundedCornerShape(99.dp))
            .background(bg)
            .press(enabled) { onClick() }
            .padding(horizontal = if (small) 13.dp else 18.dp, vertical = if (small) 8.dp else 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (icon != null) {
            Ico(icon, fg, if (small) 16.dp else 18.dp)
            if (s.isNotEmpty()) Spacer(Modifier.width(7.dp))
        }
        if (s.isNotEmpty()) Txt(s, if (small) T.smallM else T.title, fg, maxLines = 1)
    }
}

@Composable
fun IconBtn(
    icon: ImageVector?,
    modifier: Modifier = Modifier,
    tint: Color = LocalPal.current.text,
    bg: Color = Color.Transparent,
    size: Dp = 44.dp,
    iconSize: Dp = 22.dp,
    enabled: Boolean = true,
    onLong: (() -> Unit)? = null,
    onClick: () -> Unit,
) {
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(bg)
            .graphicsLayer { alpha = if (enabled) 1f else 0.4f }
            .press(enabled, onLong, onClick),
        contentAlignment = Alignment.Center,
    ) { Ico(icon, tint, iconSize) }
}

@Composable
fun ChipA(label: String, active: Boolean, modifier: Modifier = Modifier, icon: ImageVector? = null, cover: String = "", count: String = "", onClick: () -> Unit) {
    val p = LocalPal.current
    Row(
        modifier
            .clip(RoundedCornerShape(99.dp))
            .background(if (active) p.text else p.soft)
            .press(onClick = onClick)
            .padding(start = if (cover.isNotEmpty() || icon != null) 6.dp else 14.dp, end = 14.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val fg = if (active) p.bg else p.text
        if (cover.isNotEmpty()) {
            Img(cover, Modifier.size(24.dp), 96, CircleShape)
            Spacer(Modifier.width(7.dp))
        } else if (icon != null) {
            Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) { Ico(icon, fg, 16.dp) }
            Spacer(Modifier.width(5.dp))
        }
        Txt(label, T.smallM, fg, maxLines = 1)
        if (count.isNotEmpty()) {
            Spacer(Modifier.width(6.dp))
            Txt(count, T.num, if (active) p.bg.copy(alpha = 0.6f) else p.text3)
        }
    }
}

// ---------- строка трека ----------

fun fmt(sec: Double): String {
    if (sec.isNaN() || sec <= 0) return "0:00"
    val s = sec.toInt()
    return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
}

val SOURCE_SHORT = mapOf("local" to "файл", "ym" to "яндекс", "sc" to "soundcloud", "sp" to "spotify")

@Composable
fun TrackRow(
    t: Track,
    current: Boolean,
    playing: Boolean,
    modifier: Modifier = Modifier,
    showSource: Boolean = true,
    index: Int? = null,
    onMore: (() -> Unit)? = null,
    onClick: () -> Unit,
) {
    val p = LocalPal.current
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(if (current) p.soft else Color.Transparent)
            .graphicsLayer { alpha = if (t.playable) 1f else 0.45f }
            .press(onLong = onMore, onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(50.dp), contentAlignment = Alignment.Center) {
            Cover(t, Modifier.fillMaxSize(), 150, RoundedCornerShape(12.dp))
            if (current) {
                Box(Modifier.fillMaxSize().clip(RoundedCornerShape(12.dp)).background(Color.Black.copy(alpha = 0.45f)), contentAlignment = Alignment.Center) {
                    EqBars(playing, p.accent)
                }
            }
        }
        Spacer(Modifier.width(13.dp))
        Column(Modifier.weight(1f)) {
            Txt(t.title, T.title, if (current) p.accent else p.text, maxLines = 1)
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (t.dl) { Ico(AIcons.download, p.voice, 13.dp); Spacer(Modifier.width(4.dp)) }
                if (t.preview) { Tag("30 сек", p.danger); Spacer(Modifier.width(5.dp)) }
                if (showSource && t.source.isNotEmpty()) { Tag(SOURCE_SHORT[t.source] ?: t.source, p.text3); Spacer(Modifier.width(5.dp)) }
                Txt(t.artist.ifEmpty { t.album }, T.small, p.text2, maxLines = 1)
            }
        }
        if (t.duration > 0) Txt(fmt(t.duration), T.num, p.text3, Modifier.padding(start = 8.dp))
        if (onMore != null) IconBtn(AIcons.more, tint = p.text3, size = 38.dp, iconSize = 20.dp, onClick = onMore)
    }
}

@Composable
fun Tag(s: String, c: Color) {
    Box(Modifier.clip(RoundedCornerShape(5.dp)).border(1.dp, c.copy(alpha = 0.5f), RoundedCornerShape(5.dp)).padding(horizontal = 4.dp, vertical = 0.dp)) {
        Txt(s, T.tiny, c, maxLines = 1)
    }
}

/** Три столбика «играет» поверх обложки. */
@Composable
fun EqBars(on: Boolean, color: Color, modifier: Modifier = Modifier) {
    val tr = rememberInfiniteTransition(label = "bars")
    val a by tr.animateFloat(0.3f, 1f, infiniteRepeatable(tween(420, easing = LinearEasing), RepeatMode.Reverse), label = "a")
    val b by tr.animateFloat(1f, 0.25f, infiniteRepeatable(tween(530, easing = LinearEasing), RepeatMode.Reverse), label = "b")
    val c by tr.animateFloat(0.5f, 0.9f, infiniteRepeatable(tween(360, easing = LinearEasing), RepeatMode.Reverse), label = "c")
    Canvas(modifier.size(18.dp)) {
        val w = size.width / 5
        listOf(if (on) a else 0.35f, if (on) b else 0.6f, if (on) c else 0.45f).forEachIndexed { i, h ->
            val x = w * (i * 2) + w / 2
            drawLine(color, Offset(x, size.height), Offset(x, size.height * (1 - h)), strokeWidth = w, cap = StrokeCap.Round)
        }
    }
}

// ---------- пластинка ----------
// Фирменный элемент телефона: обложка — яблоко пластинки, дорожки вокруг, крутится, пока играет.
// barrel (0…1) — сила бочки: обручи проступают поверх, как на компьютере.

@Composable
fun Disc(t: Track?, playing: Boolean, modifier: Modifier, barrel: Float = 0f, rpm: Float = 20f, labelSize: Int = 480, held: Boolean = false, hand: Float = 0f) {
    val p = LocalPal.current
    var angle by remember { mutableFloatStateOf(0f) }
    val speed = remember { Animatable(0f) }
    // держат пальцем — стоит и крутится только за рукой (hand — сколько накрутили)
    LaunchedEffect(playing, held) { if (held) speed.snapTo(0f) else speed.animateTo(if (playing) 1f else 0f, tween(if (playing) 700 else 1400)) }
    LaunchedEffect(Unit) {
        var last = 0L
        while (true) {
            withFrameNanos { now ->
                if (last != 0L) angle = (angle + (now - last) / 1e9f * rpm / 60f * 360f * speed.value) % 360f
                last = now
            }
        }
    }
    Box(modifier, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val r = size.minDimension / 2
            drawCircle(Brush.radialGradient(listOf(Color(0xFF17110F), Color(0xFF0B0807)), center, r), r)
            val grooves = 16
            for (i in 0 until grooves) {
                val rr = r * (0.52f + i * 0.028f)
                drawCircle(Color.White.copy(alpha = if (i % 4 == 0) 0.07f else 0.035f), rr, style = Stroke(1f))
            }
            // блик на пластинке — стоит на месте, пока она крутится
            drawArc(Brush.sweepGradient(listOf(Color.Transparent, Color.White.copy(alpha = 0.09f), Color.Transparent), center), -60f, 60f, true)
            if (barrel > 0.01f) {
                for (k in 0..2) drawCircle(p.voice.copy(alpha = barrel * (0.55f - k * 0.15f)), r * (0.98f - k * 0.06f), style = Stroke(3.dp.toPx()))
            }
        }
        Cover(t, Modifier.fillMaxSize(0.46f).graphicsLayer { rotationZ = angle + hand }, labelSize, CircleShape)
        Box(Modifier.size(10.dp).clip(CircleShape).background(p.bg))
    }
}

// ---------- ползунок ----------

@Composable
fun Scrub(value: Float, modifier: Modifier = Modifier, color: Color = LocalPal.current.text, track: Color = LocalPal.current.line, height: Dp = 4.dp, onInput: (Float) -> Unit, onDone: (Float) -> Unit) {
    var drag by remember { mutableStateOf<Float?>(null) }
    val v = drag ?: value
    val input by rememberUpdatedState(onInput)
    val done by rememberUpdatedState(onDone)
    Box(
        modifier
            .height(28.dp)
            .pointerInput(Unit) {
                detectTapGestures { o -> val f = (o.x / size.width).coerceIn(0f, 1f); input(f); done(f) }
            }
            .pointerInput(Unit) {
                detectHorizontalDragGestures(
                    onDragStart = { o -> drag = (o.x / size.width).coerceIn(0f, 1f); input(drag!!) },
                    onDragEnd = { drag?.let { done(it) }; drag = null },
                    onDragCancel = { drag = null },
                ) { ch, _ -> drag = (ch.position.x / size.width).coerceIn(0f, 1f); input(drag!!) }
            },
        contentAlignment = Alignment.CenterStart,
    ) {
        val h = if (drag != null) height * 1.8f else height
        Box(Modifier.fillMaxWidth().height(h).clip(CircleShape).background(track))
        Box(Modifier.fillMaxWidth(v.coerceIn(0f, 1f)).height(h).clip(CircleShape).background(color))
    }
}

@Composable
fun Spinner(modifier: Modifier = Modifier, color: Color = LocalPal.current.accent, size: Dp = 26.dp) {
    val tr = rememberInfiniteTransition(label = "spin")
    val a by tr.animateFloat(0f, 360f, infiniteRepeatable(tween(900, easing = LinearEasing)), label = "a")
    Canvas(modifier.size(size)) {
        drawArc(color, a, 260f, false, style = Stroke(2.5.dp.toPx(), cap = StrokeCap.Round))
    }
}

// ---------- заголовки разделов ----------

@Composable
fun SectionHead(s: String, modifier: Modifier = Modifier, action: String? = null, onAction: (() -> Unit)? = null) {
    val p = LocalPal.current
    Row(modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalAlignment = Alignment.Bottom) {
        Txt(s.lowercase(), T.h2, p.text, Modifier.weight(1f), maxLines = 1)
        if (action != null && onAction != null) Txt(action, T.smallM, p.text2, Modifier.press(onClick = onAction).padding(4.dp))
    }
}

/** Мягкое свечение цвета акцента за элементом. */
fun Modifier.glow(color: Color, radius: Float = 0.6f): Modifier = drawBehind {
    drawCircle(Brush.radialGradient(listOf(color.copy(alpha = 0.35f), Color.Transparent), center, max(size.width, size.height) * radius))
}

internal fun clamp01(x: Float) = min(1f, max(0f, x))
internal const val TAU = (2 * PI).toFloat()
