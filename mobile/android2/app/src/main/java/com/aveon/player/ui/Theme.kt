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
// k зажимаем: пружины проскакивают за 0…1, а цвет вне диапазона роняет Compose
fun Color.mix(o: Color, k: Float): Color {
    val t = k.coerceIn(0f, 1f)
    return Color(red + (o.red - red) * t, green + (o.green - green) * t, blue + (o.blue - blue) * t, alpha + (o.alpha - alpha) * t)
}

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

/** Цвета интерфейса — как у Apple Music: чёрный фон, серые плашки, розово-красный акцент. */
val ApplePal = Pal(
    bg = Color(0xFF000000), surface = Color(0xFF1C1C1E), soft = Color(0xFF2C2C2E), line = Color(0xFF38383A),
    hoop = Color(0xFF48484A), text = Color(0xFFFFFFFF), text2 = Color(0x99EBEBF5), text3 = Color(0x4DEBEBF5),
    accent = Color(0xFFFA2D48), voice = Color(0xFF9AA8FF), danger = Color(0xFFFF453A),
)

/** Интерфейс (вкладки, списки, шторки). */
val LocalPal = staticCompositionLocalOf { ApplePal }

/** Палитра трека из движка (обложка, «Оформление») — фон плеера, визуализатор, итоги года. */
val LocalArt = staticCompositionLocalOf { DefaultPal }

/** Палитра трека плавно перетекает при смене трека — как фон плеера на компьютере. */
@Composable
fun AnimatedPal(target: Pal, content: @Composable () -> Unit) {
    val spec = tween<Color>(900)
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
    val art = Pal(bg, surface, soft, line, hoop, text, text2, text3, accent, voice, danger)
    CompositionLocalProvider(LocalArt provides art, LocalPal provides ApplePal.copy(voice = voice), content = content)
}

/** Экран в цветах трека (визуализатор, итоги года рисуются его палитрой). */
@Composable
fun ArtColors(content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalPal provides LocalArt.current, content = content)
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

/** Шкала текста в духе Apple (SF Pro) — Onest на его месте. */
object A {
    private fun st(size: Int, w: FontWeight, track: Double = 0.0, line: Float = 1.25f) =
        TextStyle(fontFamily = Body, fontWeight = w, fontSize = size.sp, letterSpacing = track.em, lineHeight = (size * line).sp)

    val large = st(33, FontWeight.Bold, -0.025, 1.15f)   // большой заголовок вкладки
    val title1 = st(28, FontWeight.Bold, -0.02, 1.15f)
    val title2 = st(22, FontWeight.Bold, -0.015, 1.2f)   // разделы «Недавно слушал ›»
    val title3 = st(20, FontWeight.SemiBold, -0.01)
    val headline = st(17, FontWeight.SemiBold, -0.01)
    val body = st(17, FontWeight.Normal, -0.01)
    val callout = st(16, FontWeight.Normal)
    val subhead = st(15, FontWeight.Normal)
    val subheadM = st(15, FontWeight.Medium)
    val footnote = st(13, FontWeight.Normal)
    val footnoteM = st(13, FontWeight.SemiBold)
    val caption = st(12, FontWeight.Normal)
    val tab = st(10, FontWeight.SemiBold, 0.01)
    val num = TextStyle(fontFamily = Body, fontWeight = FontWeight.Medium, fontSize = 12.sp, fontFeatureSettings = "tnum")
    val lyric = st(30, FontWeight.Bold, -0.02, 1.2f)
}
