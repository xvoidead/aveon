package com.aveon.player.ui

import android.graphics.Bitmap
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
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
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.aveon.player.Engine
import com.aveon.player.Images
import com.aveon.player.Track
import kotlin.math.PI
import kotlin.math.max
import kotlin.math.min

// Кирпичики интерфейса в духе Apple Music: чёрный фон, серые плашки, тонкие разделители, мягкие пружины.

// ---------- текст ----------

@Composable
fun Txt(
    s: String,
    style: TextStyle = A.body,
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
    BasicText(s, modifier = modifier.basicMarquee(iterations = Int.MAX_VALUE, initialDelayMillis = 2200, velocity = 36.dp), style = style.copy(color = color), maxLines = 1)
}

// ---------- значки ----------

@Composable
fun Ico(icon: ImageVector?, tint: Color = LocalPal.current.text, size: Dp = 22.dp, modifier: Modifier = Modifier) {
    if (icon == null) { Spacer(modifier.size(size)); return }
    Image(painter = rememberVectorPainter(icon), contentDescription = null, colorFilter = ColorFilter.tint(tint), modifier = modifier.size(size))
}

// ---------- нажатия ----------
// Как в iOS: нажатое чуть уменьшается и тускнеет, отпускаешь — пружинит обратно.

@OptIn(ExperimentalFoundationApi::class)
fun Modifier.press(enabled: Boolean = true, onLong: (() -> Unit)? = null, scale: Float = 0.96f, onClick: () -> Unit): Modifier = composed {
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val k by animateFloatAsState(if (pressed) scale else 1f, spring(dampingRatio = 0.55f, stiffness = if (pressed) 1400f else 500f), label = "press")
    val a by animateFloatAsState(if (pressed) 0.7f else 1f, tween(if (pressed) 60 else 220), label = "pressA")
    val haptic = LocalHapticFeedback.current
    this
        .graphicsLayer { scaleX = k; scaleY = k; alpha = a }
        .combinedClickable(
            interactionSource = src,
            indication = null,
            enabled = enabled,
            onLongClick = onLong?.let { { haptic.performHapticFeedback(HapticFeedbackType.LongPress); it() } },
            onClick = onClick,
        )
}

/** Строка списка: при нажатии подсвечивается серым, как ячейка iOS. */
@OptIn(ExperimentalFoundationApi::class)
fun Modifier.cell(enabled: Boolean = true, onLong: (() -> Unit)? = null, onClick: () -> Unit): Modifier = composed {
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val hl by animateFloatAsState(if (pressed) 1f else 0f, tween(if (pressed) 40 else 380), label = "cell")
    val haptic = LocalHapticFeedback.current
    val c = LocalPal.current.soft
    this
        .drawBehind { if (hl > 0f) drawRect(c.copy(alpha = hl)) }
        .combinedClickable(
            interactionSource = src,
            indication = null,
            enabled = enabled,
            onLongClick = onLong?.let { { haptic.performHapticFeedback(HapticFeedbackType.LongPress); it() } },
            onClick = onClick,
        )
}

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
    shape: Shape = RoundedCornerShape(8.dp),
    scale: ContentScale = ContentScale.Crop,
    fallback: @Composable BoxScope.() -> Unit = {},
) {
    val ctx = LocalContext.current
    val bmp by produceState<Bitmap?>(Images.cached(url, size), url, size) {
        value = Images.cached(url, size)
        if (value == null) value = Images.load(ctx, url, size)
    }
    val p = LocalPal.current
    // картинка проявляется плавно, а не выскакивает
    val shown = remember(url) { Animatable(if (Images.cached(url, size) != null) 1f else 0f) }
    LaunchedEffect(bmp) { if (bmp != null) shown.animateTo(1f, tween(260)) }
    Box(modifier.clip(shape).background(p.soft), contentAlignment = Alignment.Center) {
        val b = bmp
        if (b != null) Image(b.asImageBitmap(), null, contentScale = scale, modifier = Modifier.fillMaxSize().graphicsLayer { alpha = shown.value })
        else fallback()
    }
}

/** Обложка трека, а без неё — серая плашка с нотой, как в Apple Music. */
@Composable
fun Cover(t: Track?, modifier: Modifier, size: Int = 200, shape: Shape = RoundedCornerShape(8.dp)) {
    val p = LocalPal.current
    Img(t?.cover ?: "", modifier, size, shape) {
        Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(p.soft, p.line))), contentAlignment = Alignment.Center) {
            Txt("♪", A.title2, p.text3)
        }
    }
}

// ---------- кнопки ----------

/** Кнопка-плашка. primary — заливка акцентом; tinted — серая плашка с текстом цвета акцента (как «Слушать» в Apple Music). */
@Composable
fun Pill(
    s: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    primary: Boolean = false,
    danger: Boolean = false,
    tinted: Boolean = false,
    enabled: Boolean = true,
    small: Boolean = false,
    onClick: () -> Unit,
) {
    val p = LocalPal.current
    val bg = if (primary) p.accent else p.soft
    val fg = when { primary -> p.onAccent; danger -> p.danger; tinted -> p.accent; else -> p.text }
    Row(
        modifier
            .graphicsLayer { alpha = if (enabled) 1f else 0.4f }
            .clip(RoundedCornerShape(if (small) 99.dp else 12.dp))
            .background(bg)
            .press(enabled) { onClick() }
            .padding(horizontal = if (small) 14.dp else 18.dp, vertical = if (small) 7.dp else 13.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (icon != null) {
            Ico(icon, fg, if (small) 15.dp else 18.dp)
            if (s.isNotEmpty()) Spacer(Modifier.width(7.dp))
        }
        if (s.isNotEmpty()) Txt(s, if (small) A.footnoteM else A.headline, fg, maxLines = 1)
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
            .graphicsLayer { alpha = if (enabled) 1f else 0.35f }
            .press(enabled, onLong, 0.88f, onClick)
            .clip(CircleShape)
            .background(bg),
        contentAlignment = Alignment.Center,
    ) { Ico(icon, tint, iconSize) }
}

/** Фишка-фильтр: выбранная — белая с чёрным текстом. */
@Composable
fun ChipA(label: String, active: Boolean, modifier: Modifier = Modifier, icon: ImageVector? = null, cover: String = "", count: String = "", onClick: () -> Unit) {
    val p = LocalPal.current
    val bg by androidx.compose.animation.animateColorAsState(if (active) p.text else p.soft, tween(200), label = "chip")
    val fg = if (active) Color.Black else p.text
    Row(
        modifier
            .clip(RoundedCornerShape(99.dp))
            .background(bg)
            .press(onClick = onClick)
            .padding(start = if (cover.isNotEmpty() || icon != null) 6.dp else 14.dp, end = 14.dp, top = 7.dp, bottom = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (cover.isNotEmpty()) {
            Img(cover, Modifier.size(22.dp), 96, CircleShape)
            Spacer(Modifier.width(7.dp))
        } else if (icon != null) {
            Box(Modifier.size(22.dp), contentAlignment = Alignment.Center) { Ico(icon, fg, 15.dp) }
            Spacer(Modifier.width(5.dp))
        }
        Txt(label, A.footnoteM, fg, maxLines = 1)
        if (count.isNotEmpty()) {
            Spacer(Modifier.width(6.dp))
            Txt(count, A.num, if (active) Color.Black.copy(alpha = 0.5f) else p.text3)
        }
    }
}

// ---------- строка трека (как в Apple Music) ----------

fun fmt(sec: Double): String {
    if (sec.isNaN() || sec <= 0) return "0:00"
    val s = sec.toInt()
    return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
}

val SOURCE_SHORT = mapOf("local" to "Файл", "ym" to "Яндекс", "sc" to "SoundCloud", "sp" to "Spotify")

@Composable
fun TrackRow(
    t: Track,
    current: Boolean,
    playing: Boolean,
    modifier: Modifier = Modifier,
    showSource: Boolean = true,
    longMenu: Boolean = true,
    divider: Boolean = true,
    onMore: (() -> Unit)? = null,
    onClick: () -> Unit,
) {
    val p = LocalPal.current
    Row(
        modifier
            .fillMaxWidth()
            .graphicsLayer { alpha = if (t.playable) 1f else 0.4f }
            .cell(onLong = if (longMenu) onMore else null, onClick = onClick)
            .padding(start = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
            Cover(t, Modifier.fillMaxSize(), 150, RoundedCornerShape(6.dp))
            if (current) {
                Box(Modifier.fillMaxSize().clip(RoundedCornerShape(6.dp)).background(Color.Black.copy(alpha = 0.45f)), contentAlignment = Alignment.Center) {
                    EqBars(playing, Color.White)
                }
            }
        }
        Spacer(Modifier.width(12.dp))
        Row(Modifier.weight(1f).hairline(divider), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f).padding(vertical = 11.dp)) {
                Txt(t.title, A.callout, if (current) p.accent else p.text, maxLines = 1)
                Spacer(Modifier.height(2.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (t.explicit) { Explicit(); Spacer(Modifier.width(5.dp)) }
                    if (t.dl) { Ico(AIcons.download, p.text2, 12.dp); Spacer(Modifier.width(4.dp)) }
                    if (t.preview) { Tag("30 сек", p.danger); Spacer(Modifier.width(5.dp)) }
                    val sub = listOfNotNull(t.artist.ifEmpty { t.album }.ifEmpty { null }, if (showSource) SOURCE_SHORT[t.source] else null).joinToString(" · ")
                    Txt(sub, A.footnote, p.text2, maxLines = 1)
                }
            }
            if (onMore != null) IconBtn(G.ellipsis, tint = p.text, size = 44.dp, iconSize = 18.dp, onClick = onMore)
            else Spacer(Modifier.width(16.dp))
        }
    }
}

/** Тонкий разделитель снизу (0.5 dp), как у ячеек iOS. */
fun Modifier.hairline(on: Boolean = true, color: Color? = null): Modifier = composed {
    if (!on) return@composed this
    val c = color ?: LocalPal.current.line
    drawBehind { drawLine(c, Offset(0f, size.height), Offset(size.width, size.height), 0.5.dp.toPx()) }
}

/** Значок «E» — трек с матом (как у Apple Music). */
@Composable
fun Explicit(color: Color = LocalPal.current.text2) {
    Box(Modifier.size(14.dp).clip(RoundedCornerShape(3.dp)).background(color.copy(alpha = 0.55f)), contentAlignment = Alignment.Center) {
        Txt("E", A.tab, Color.Black)
    }
}

@Composable
fun Tag(s: String, c: Color) {
    Box(Modifier.clip(RoundedCornerShape(4.dp)).background(c.copy(alpha = 0.18f)).padding(horizontal = 5.dp, vertical = 1.dp)) {
        Txt(s, A.tab, c, maxLines = 1)
    }
}

/** Три столбика «играет» поверх обложки. */
@Composable
fun EqBars(on: Boolean, color: Color, modifier: Modifier = Modifier) {
    val tr = rememberInfiniteTransition(label = "bars")
    val a by tr.animateFloat(0.3f, 1f, infiniteRepeatable(tween(420, easing = LinearEasing), RepeatMode.Reverse), label = "a")
    val b by tr.animateFloat(1f, 0.25f, infiniteRepeatable(tween(530, easing = LinearEasing), RepeatMode.Reverse), label = "b")
    val c by tr.animateFloat(0.5f, 0.9f, infiniteRepeatable(tween(360, easing = LinearEasing), RepeatMode.Reverse), label = "c")
    val d by tr.animateFloat(0.8f, 0.35f, infiniteRepeatable(tween(470, easing = LinearEasing), RepeatMode.Reverse), label = "d")
    Canvas(modifier.size(16.dp)) {
        val w = size.width / 7
        listOf(if (on) a else 0.3f, if (on) b else 0.5f, if (on) c else 0.4f, if (on) d else 0.3f).forEachIndexed { i, h ->
            val x = w * (i * 2) + w / 2
            drawLine(color, Offset(x, size.height), Offset(x, size.height * (1 - h)), strokeWidth = w, cap = StrokeCap.Round)
        }
    }
}

// ---------- пластинка (нужна итогам года) ----------

@Composable
fun Disc(t: Track?, playing: Boolean, modifier: Modifier, barrel: Float = 0f, rpm: Float = 20f, labelSize: Int = 480) {
    val p = LocalPal.current
    var angle by remember { mutableFloatStateOf(0f) }
    val speed = remember { Animatable(0f) }
    LaunchedEffect(playing) { speed.animateTo(if (playing) 1f else 0f, tween(if (playing) 700 else 1400)) }
    LaunchedEffect(Unit) {
        var last = 0L
        while (true) withFrameNanos { now ->
            if (last != 0L) angle = (angle + (now - last) / 1e9f * rpm / 60f * 360f * speed.value) % 360f
            last = now
        }
    }
    Box(modifier, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val r = size.minDimension / 2
            drawCircle(Brush.radialGradient(listOf(Color(0xFF17110F), Color(0xFF0B0807)), center, r), r)
            for (i in 0 until 16) drawCircle(Color.White.copy(alpha = if (i % 4 == 0) 0.07f else 0.035f), r * (0.52f + i * 0.028f), style = Stroke(1f))
            if (barrel > 0.01f) for (k in 0..2) drawCircle(p.voice.copy(alpha = barrel * (0.55f - k * 0.15f)), r * (0.98f - k * 0.06f), style = Stroke(3.dp.toPx()))
        }
        Cover(t, Modifier.fillMaxSize(0.46f).graphicsLayer { rotationZ = angle }, labelSize, CircleShape)
        Box(Modifier.size(10.dp).clip(CircleShape).background(p.bg))
    }
}

// ---------- ползунок (как полоска перемотки в Apple Music) ----------
// Тонкая полоска без кружка; держишь — утолщается и светлеет, тянешь — двигается за пальцем.

@Composable
fun Scrub(
    value: Float,
    modifier: Modifier = Modifier,
    color: Color = LocalPal.current.text,
    track: Color = LocalPal.current.text.copy(alpha = 0.2f),
    height: Dp = 6.dp,
    onInput: (Float) -> Unit,
    onDone: (Float) -> Unit,
) {
    var drag by remember { mutableStateOf<Float?>(null) }
    val v = drag ?: value
    val input by rememberUpdatedState(onInput)
    val done by rememberUpdatedState(onDone)
    val cur by rememberUpdatedState(v)
    val haptic = LocalHapticFeedback.current
    val h by animateDpAsState(if (drag != null) height * 2f else height, spring(dampingRatio = 0.6f, stiffness = 700f), label = "scrubH")
    Box(
        modifier
            .height(30.dp)
            .pointerInput(Unit) {
                // палец кладёшь где угодно — полоска двигается от текущего места, а не прыгает (как в iOS)
                awaitEachGesture {
                    val down = awaitFirstDown()
                    val start = cur
                    val x0 = down.position.x
                    drag = start
                    var moved = false
                    while (true) {
                        val ev = awaitPointerEvent()
                        val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                        if (!ch.pressed) break
                        val dx = ch.position.x - x0
                        if (!moved && kotlin.math.abs(dx) > 6f) moved = true
                        if (moved) {
                            ch.consume()
                            val nv = (start + dx / size.width).coerceIn(0f, 1f)
                            if ((nv == 0f || nv == 1f) && drag != nv) haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                            drag = nv
                            input(nv)
                        }
                    }
                    if (!moved) {
                        val f = (x0 / size.width).coerceIn(0f, 1f)
                        input(f); done(f)
                    } else drag?.let { done(it) }
                    drag = null
                }
            },
        contentAlignment = Alignment.CenterStart,
    ) {
        Box(Modifier.fillMaxWidth().height(h).clip(CircleShape).background(if (drag != null) track.copy(alpha = track.alpha * 1.4f) else track)) {
            Box(Modifier.fillMaxWidth(v.coerceIn(0f, 1f)).height(h).background(if (drag != null) color else color.copy(alpha = color.alpha * 0.75f)))
        }
    }
}

@Composable
fun Spinner(modifier: Modifier = Modifier, color: Color = LocalPal.current.text2, size: Dp = 24.dp) {
    val tr = rememberInfiniteTransition(label = "spin")
    val a by tr.animateFloat(0f, 360f, infiniteRepeatable(tween(850, easing = LinearEasing)), label = "a")
    Canvas(modifier.size(size)) {
        drawArc(color, a, 270f, false, style = Stroke(2.4.dp.toPx(), cap = StrokeCap.Round))
    }
}

/** Переключатель iOS: зелёный, с пружинящим кружком. */
@Composable
fun Toggle(on: Boolean) {
    val k by animateFloatAsState(if (on) 1f else 0f, spring(dampingRatio = 0.68f, stiffness = 600f), label = "toggle")
    val bg = Color(0xFF39393D).mix(Color(0xFF30D158), k.coerceIn(0f, 1f))
    Box(Modifier.size(width = 51.dp, height = 31.dp).clip(CircleShape).background(bg).padding(2.dp)) {
        Box(Modifier.offset(x = (20 * k).dp).size(27.dp).clip(CircleShape).background(Color.White))
    }
}

// ---------- заголовки разделов ----------

/** «Недавно слушал ›» — жирный заголовок раздела со стрелкой, если раздел открывается. */
@Composable
fun SectionHead(s: String, modifier: Modifier = Modifier, onOpen: (() -> Unit)? = null) {
    val p = LocalPal.current
    Row(
        modifier.fillMaxWidth().padding(horizontal = 16.dp).then(if (onOpen != null) Modifier.press(scale = 0.98f, onClick = onOpen) else Modifier),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Txt(s, A.title2, p.text, maxLines = 1)
        if (onOpen != null) {
            Spacer(Modifier.width(4.dp))
            Ico(G.chevronR, p.text2, 17.dp)
        }
    }
}

/** Поле ввода: серая плашка со скруглением, как поиск в iOS. */
@Composable
fun Field(
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    password: Boolean = false,
    number: Boolean = false,
    search: Boolean = false,
    multi: Boolean = false,
    onDone: (() -> Unit)? = null,
) {
    val p = LocalPal.current
    BasicTextField(
        value = value,
        onValueChange = onChange,
        modifier = modifier.fillMaxWidth().clip(RoundedCornerShape(11.dp)).background(p.surface).padding(horizontal = if (search) 10.dp else 14.dp, vertical = 10.dp),
        textStyle = A.body.copy(color = p.text),
        cursorBrush = SolidColor(p.accent),
        singleLine = !multi,
        visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(
            keyboardType = when { password -> KeyboardType.Password; number -> KeyboardType.Number; else -> KeyboardType.Text },
            imeAction = if (multi) ImeAction.Default else if (search) ImeAction.Search else ImeAction.Done,
        ),
        keyboardActions = KeyboardActions(onDone = { onDone?.invoke() }, onSearch = { onDone?.invoke() }),
        decorationBox = { inner ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (search) { Ico(G.search, p.text2, 17.dp); Spacer(Modifier.width(7.dp)) }
                Box(Modifier.weight(1f)) {
                    if (value.isEmpty() && placeholder.isNotEmpty()) Txt(placeholder, A.body, p.text2, maxLines = 1)
                    inner()
                }
                if (search && value.isNotEmpty()) {
                    Box(Modifier.size(18.dp).clip(CircleShape).background(p.text2).tap { onChange("") }, contentAlignment = Alignment.Center) {
                        Ico(AIcons.close, p.surface, 11.dp)
                    }
                }
            }
        },
    )
}

@Composable
fun BoxScope.CloseButton(onClick: () -> Unit) {
    IconBtn(AIcons.close, Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(10.dp), bg = Color.Black.copy(alpha = 0.3f), onClick = onClick)
}

fun Modifier.heightInScreen(frac: Float): Modifier = composed {
    val h = LocalConfiguration.current.screenHeightDp
    heightIn(max = (h * frac).dp)
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

fun lerp(a: Float, b: Float, k: Float) = a + (b - a) * k
internal fun clamp01(x: Float) = min(1f, max(0f, x))
internal const val TAU = (2 * PI).toFloat()

@Suppress("unused")
private val springSoft = spring<Float>(dampingRatio = Spring.DampingRatioLowBouncy, stiffness = Spring.StiffnessLow)
