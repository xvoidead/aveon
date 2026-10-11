package com.aveon.player.ui

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.aveon.player.Engine
import com.aveon.player.Images
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.random.Random

private val STYLES = listOf("пластинка", "частицы", "эфир", "столбики")

private class Particle(var x: Float, var y: Float, var vx: Float, var vy: Float, var life: Float, val s: Float, val voice: Boolean)

@Composable
fun VisualizerScreen(onClose: () -> Unit) {
    val p = LocalPal.current
    val ctx = LocalContext.current
    val pl by Engine.player.collectAsState()
    val spec by Engine.spectrum.collectAsState()
    SpectrumUser(true)
    val prefs = remember { ctx.getSharedPreferences("aveon-ui", Context.MODE_PRIVATE) }
    var style by remember { mutableIntStateOf(prefs.getInt("viz", 0)) }
    var frame by remember { mutableLongStateOf(0L) }
    var bass by remember { mutableFloatStateOf(0f) }
    var angle by remember { mutableFloatStateOf(0f) }
    val parts = remember { ArrayList<Particle>() }
    var cover by remember { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(pl.track?.cover) { cover = pl.track?.cover?.let { Images.load(ctx, it, 720) } }
    LaunchedEffect(Unit) {
        while (true) withFrameNanos { now ->
            frame = now
            val b = spec.take(8).maxOrNull() ?: 0f
            bass += (b - bass) * 0.3f
            angle += if (pl.playing) 0.7f else 0f
        }
    }

    Box(Modifier.fillMaxSize().background(p.bg).absorb()) {
        Canvas(Modifier.fillMaxSize()) {
            frame.let { }
            val w = size.width
            val h = size.height
            val cx = w / 2
            val cy = h / 2
            val r = min(w, h)
            fun band(k: Int, n: Int): Float {
                if (spec.isEmpty()) return 0f
                val i = (k.toFloat() / n * (spec.size - 1)).toInt().coerceIn(0, spec.size - 1)
                return spec[i]
            }
            when (style) {
                0 -> { // пластинка: обложка крутится, вокруг — лучи спектра
                    val rr = r * (0.26f + bass * 0.02f)
                    drawCircle(Color(0xFF0D0A09), rr * 1.35f, Offset(cx, cy))
                    for (k in 0 until 16) drawCircle(Color.White.copy(alpha = 0.04f), rr * (0.75f + k * 0.035f), Offset(cx, cy), style = Stroke(1f))
                    val bmp = cover
                    val clip = Path().apply { addOval(androidx.compose.ui.geometry.Rect(Offset(cx, cy), rr * 0.62f)) }
                    rotate(angle, Offset(cx, cy)) {
                        clipPath(clip) {
                            if (bmp != null) drawImage(
                                bmp.asImageBitmap(),
                                dstOffset = IntOffset((cx - rr * 0.62f).toInt(), (cy - rr * 0.62f).toInt()),
                                dstSize = IntSize((rr * 1.24f).toInt(), (rr * 1.24f).toInt()),
                            ) else drawCircle(p.accent, rr * 0.62f, Offset(cx, cy))
                        }
                    }
                    val n = 120
                    for (k in 0 until n) {
                        val half = if (k < n / 2) k else n - 1 - k
                        val v = band(half, n / 2)
                        val a = (k.toFloat() / n) * 2 * PI.toFloat() - PI.toFloat() / 2
                        val r0 = rr * 1.45f
                        val r1 = r0 + v * r * 0.22f + 2
                        drawLine(
                            (if (v > 0.7f) p.voice else p.accent).copy(alpha = 0.3f + v * 0.7f),
                            Offset(cx + cos(a) * r0, cy + sin(a) * r0), Offset(cx + cos(a) * r1, cy + sin(a) * r1),
                            strokeWidth = r / 220f, cap = StrokeCap.Round,
                        )
                    }
                }
                1 -> { // частицы: взрываются на басах
                    if (bass > 0.55f && Random.nextFloat() < bass) {
                        repeat((6 + bass * 16).toInt()) {
                            val a = Random.nextFloat() * 2 * PI.toFloat()
                            val sp = (2 + Random.nextFloat() * 7 * bass) * density
                            parts.add(Particle(cx, cy, cos(a) * sp, sin(a) * sp, 1f, (1.5f + Random.nextFloat() * 3.5f) * density, Random.nextFloat() < 0.3f))
                        }
                    }
                    val it = parts.iterator()
                    while (it.hasNext()) {
                        val q = it.next()
                        q.x += q.vx; q.y += q.vy; q.vx *= 0.99f; q.vy *= 0.99f; q.life -= 0.008f
                        if (q.life <= 0 || q.x < -50 || q.x > w + 50 || q.y < -50 || q.y > h + 50) { it.remove(); continue }
                        drawCircle((if (q.voice) p.voice else p.accent).copy(alpha = q.life.coerceIn(0f, 1f)), q.s, Offset(q.x, q.y))
                    }
                    while (parts.size > 1500) parts.removeAt(0)
                    drawCircle(p.accent.copy(alpha = 0.9f), r * (0.06f + bass * 0.05f), Offset(cx, cy))
                }
                2 -> { // эфир: линии, как на волне
                    for (k in 0 until 9) {
                        val path = Path()
                        val y0 = h * (0.15f + k * 0.0875f)
                        var x = 0f
                        while (x <= w) {
                            val u = x / w
                            val v = band((u * 48).toInt(), 48)
                            val y = y0 + sin(u * PI.toFloat() * (2 + k * 0.5f) + angle / 20f * (1 + k * 0.2f)) * h * 0.03f * (0.5f + bass * 2) - v * h * 0.05f
                            if (x == 0f) path.moveTo(x, y) else path.lineTo(x, y)
                            x += 5 * density
                        }
                        val mid = k == 4
                        drawPath(path, (if (mid) p.voice else p.accent).copy(alpha = if (mid) 0.95f else 0.25f + (1 - kotlin.math.abs(k - 4) / 4f) * 0.4f), style = Stroke(if (mid) 3 * density else 1.4f * density))
                    }
                }
                else -> { // столбики
                    val n = 48
                    val gap = 4 * density
                    val bw = (w - gap * (n + 1)) / n
                    for (k in 0 until n) {
                        val v = band(k, n).pow(1.2f)
                        val bh = maxOf(3 * density, v * h * 0.7f)
                        val x = gap + k * (bw + gap)
                        drawRect(Brush.verticalGradient(listOf(p.voice, p.accent), h - bh, h), Offset(x, h - bh), androidx.compose.ui.geometry.Size(bw, bh), alpha = 0.5f + v * 0.5f)
                    }
                }
            }
        }
        Column(Modifier.align(Alignment.BottomStart).navigationBarsPadding().padding(20.dp).fillMaxWidth()) {
            pl.track?.let {
                Txt(it.title, T.h2, p.text, maxLines = 1)
                Txt(it.artist, T.body, p.text2, maxLines = 1)
            }
            Row(Modifier.padding(top = 14.dp).clip(RoundedCornerShape(16.dp)).background(Color.Black.copy(alpha = 0.3f)).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                STYLES.forEachIndexed { i, s ->
                    ChipA(s, style == i, Modifier.weight(1f)) { style = i; prefs.edit().putInt("viz", i).apply(); parts.clear() }
                }
            }
        }
        CloseButton(onClose)
    }
}

