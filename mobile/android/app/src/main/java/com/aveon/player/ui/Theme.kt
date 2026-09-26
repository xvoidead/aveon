package com.aveon.player.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.aveon.player.R

// ---------- палитра ----------
// Цвета приходят из движка: это те же переменные, что красят плеер на компьютере — обложка
// (палитра трека), тема и акцент из «Оформления». Поэтому телефон меняется вместе с настройками.

@Immutable
data class Pal(
    val bg: Color,        // --oak: фон
    val surface: Color,   // --oak-2: карточки, шторки
    val soft: Color,      // --rivet: мягкие плашки
    val line: Color,      // --rivet-2: линии и неактивное
    val hoop: Color,      // --hoop: обручи бочки
    val text: Color,
    val text2: Color,
    val text3: Color,
    val accent: Color,    // --amber
    val voice: Color,     // --voice: люди, голоса, бочка
    val danger: Color,
) {
    val onAccent: Color get() = if (accent.luminance() > 0.45f) bg.darken(0.35f) else Color.White
    val onVoice: Color get() = if (voice.luminance() > 0.45f) Color(0xFF14122A) else Color.White
}

fun Color.darken(k: Float) = Color(red * (1 - k), green * (1 - k), blue * (1 - k), alpha)
fun Color.mix(o: Color, k: Float) = Color(red + (o.red - red) * k, green + (o.green - green) * k, blue + (o.blue - blue) * k, alpha + (o.alpha - alpha) * k)

val DefaultPal = Pal(
    bg = Color(0xFF1B1411), surface = Color(0xFF231A16), soft = Color(0xFF2A201B), line = Color(0xFF3A2D26),
    hoop = Color(0xFF5A4636), text = Color(0xFFF4E9DC), text2 = Color(0xFFBFAE99), text3 = Color(0xFF8A7A68),
    accent = Color(0xFFF0A63A), voice = Color(0xFF9AA8FF), danger = Color(0xFFFF7A6B),
)

/** rgb(), rgba() и color(srgb …) из getComputedStyle. Незнакомое — null. */
fun parseCss(s: String?): Color? {
    if (s.isNullOrBlank()) return null
    val v = s.trim()
    Regex("""rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+%?))?\s*\)""").matchEntire(v)?.let { m ->
        val (r, g, b) = m.destructured
        val a = m.groupValues[4].let { if (it.isEmpty()) 1f else if (it.endsWith("%")) it.dropLast(1).toFloat() / 100 else it.toFloat() }
        return Color(r.toFloat() / 255f, g.toFloat() / 255f, b.toFloat() / 255f, a.coerceIn(0f, 1f))
    }
    Regex("""color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*/\s*([\d.]+%?))?\s*\)""").matchEntire(v)?.let { m ->
        val (r, g, b) = m.destructured
        val a = m.groupValues[4].let { if (it.isEmpty()) 1f else if (it.endsWith("%")) it.dropLast(1).toFloat() / 100 else it.toFloat() }
        return Color(r.toFloat().coerceIn(0f, 1f), g.toFloat().coerceIn(0f, 1f), b.toFloat().coerceIn(0f, 1f), a.coerceIn(0f, 1f))
    }
    if (v.startsWith("#") && (v.length == 7 || v.length == 4)) {
        val hex = if (v.length == 4) v.drop(1).map { "$it$it" }.joinToString("") else v.drop(1)
        return hex.toLongOrNull(16)?.let { Color(0xFF000000 or it) }
    }
    return null
}

fun palOf(m: Map<String, String>): Pal {
    val d = DefaultPal
    fun c(k: String, def: Color) = parseCss(m[k])?.takeIf { it.alpha > 0.05f } ?: def
    return Pal(
        bg = c("oak", d.bg), surface = c("oak-2", d.surface), soft = c("rivet", d.soft), line = c("rivet-2", d.line),
        hoop = c("hoop", d.hoop), text = c("text", d.text), text2 = c("text-2", d.text2), text3 = c("text-3", d.text3),
        accent = c("amber", d.accent), voice = c("voice", d.voice), danger = c("danger", d.danger),
    )
}

val LocalPal = staticCompositionLocalOf { DefaultPal }

/** Палитра плавно перетекает при смене трека — как фон плеера на компьютере. */
@Composable
fun AnimatedPal(target: Pal, content: @Composable () -> Unit) {
    val spec = tween<Color>(700)
    val bg by animateColorAsState(target.bg, spec, label = "bg")
    val surface by animateColorAsState(target.surface, spec, label = "surface")
    val soft by animateColorAsState(target.soft, spec, label = "soft")
    val line by animateColorAsState(target.line, spec, label = "line")
    val hoop by animateColorAsState(target.hoop, spec, label = "hoop")
    val text by animateColorAsState(target.text, spec, label = "text")
    val text2 by animateColorAsState(target.text2, spec, label = "text2")
    val text3 by animateColorAsState(target.text3, spec, label = "text3")
    val accent by animateColorAsState(target.accent, spec, label = "accent")
    val voice by animateColorAsState(target.voice, spec, label = "voice")
    val danger by animateColorAsState(target.danger, spec, label = "danger")
    CompositionLocalProvider(LocalPal provides Pal(bg, surface, soft, line, hoop, text, text2, text3, accent, voice, danger), content = content)
}

// ---------- шрифты ----------
// Unbounded — заголовки и цифры, как у логотипа; Onest — всё остальное.

val Display = FontFamily(
    Font(R.font.unbounded_500, FontWeight.Medium),
    Font(R.font.unbounded_700, FontWeight.Bold),
    Font(R.font.unbounded_800, FontWeight.ExtraBold),
)
val Body = FontFamily(
    Font(R.font.onest_400, FontWeight.Normal),
    Font(R.font.onest_500, FontWeight.Medium),
    Font(R.font.onest_600, FontWeight.SemiBold),
    Font(R.font.onest_700, FontWeight.Bold),
)

object T {
    fun display(size: TextUnit, weight: FontWeight = FontWeight.ExtraBold, track: TextUnit = (-0.04).em) =
        TextStyle(fontFamily = Display, fontWeight = weight, fontSize = size, letterSpacing = track, lineHeight = size * 1.08f)

    val hero = display(34.sp)
    val h1 = display(26.sp)
    val h2 = display(19.sp, FontWeight.Bold, (-0.03).em)
    val h3 = display(15.sp, FontWeight.Bold, (-0.02).em)
    val body = TextStyle(fontFamily = Body, fontWeight = FontWeight.Normal, fontSize = 15.sp, lineHeight = 22.sp)
    val bodyM = TextStyle(fontFamily = Body, fontWeight = FontWeight.Medium, fontSize = 15.sp, lineHeight = 21.sp)
    val title = TextStyle(fontFamily = Body, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, lineHeight = 20.sp)
    val small = TextStyle(fontFamily = Body, fontWeight = FontWeight.Normal, fontSize = 13.sp, lineHeight = 18.sp)
    val smallM = TextStyle(fontFamily = Body, fontWeight = FontWeight.Medium, fontSize = 13.sp, lineHeight = 18.sp)
    val tiny = TextStyle(fontFamily = Body, fontWeight = FontWeight.SemiBold, fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.02.em)
    val num = TextStyle(fontFamily = Body, fontWeight = FontWeight.Medium, fontSize = 12.sp, fontFeatureSettings = "tnum")
}
