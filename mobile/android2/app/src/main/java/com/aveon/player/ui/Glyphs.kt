package com.aveon.player.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

// Значки вкладок и плеера в духе SF Symbols (Apple Music). Остальные значки — те же, что на компьютере (AIcons).

private fun glyph(name: String, vararg parts: Pair<String, Float>): ImageVector {
    val b = ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
    for ((d, stroke) in parts) {
        b.addPath(
            pathData = addPathNodes(d),
            fill = if (stroke == 0f) SolidColor(Color.Black) else null,
            stroke = if (stroke > 0f) SolidColor(Color.Black) else null,
            strokeLineWidth = stroke,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
        )
    }
    return b.build()
}

private fun dot(x: Float, y: Float, r: Float) = "M${x - r} $y a$r $r 0 1 0 ${2 * r} 0 a$r $r 0 1 0 ${-2 * r} 0 z"

object G {
    val home by lazy {
        glyph("home", "M12 3.3 L2.9 11 a1 1 0 0 0 1.3 1.5 l.8 -.7 V20 a1 1 0 0 0 1 1 h4 v-5.5 a1 1 0 0 1 1 -1 h2 a1 1 0 0 1 1 1 V21 h4 a1 1 0 0 0 1 -1 v-8.2 l.8 .7 a1 1 0 0 0 1.3 -1.5 z" to 0f)
    }
    val radio by lazy {
        glyph("radio", dot(12f, 12f, 2.2f) to 0f, "M8.4 8.4 a5.1 5.1 0 0 0 0 7.2 M15.6 8.4 a5.1 5.1 0 0 1 0 7.2 M5.5 5.5 a9.2 9.2 0 0 0 0 13 M18.5 5.5 a9.2 9.2 0 0 1 0 13" to 1.9f)
    }
    val library by lazy {
        glyph("library", "M5 9 h14 a2 2 0 0 1 2 2 v8 a2 2 0 0 1 -2 2 H5 a2 2 0 0 1 -2 -2 v-8 a2 2 0 0 1 2 -2 z" to 0f, "M5.5 5.8 h13 M8 2.8 h8" to 1.8f)
    }
    val search by lazy {
        glyph("search", "M10.5 4 a6.5 6.5 0 1 0 0 13 a6.5 6.5 0 1 0 0 -13 z" to 2.3f, "M15.4 15.4 L20.3 20.3" to 2.5f)
    }
    val play by lazy { glyph("play", "M6.5 4.3 v15.4 a1.1 1.1 0 0 0 1.65 .95 l12.9 -7.7 a1.1 1.1 0 0 0 0 -1.9 L8.15 3.35 A1.1 1.1 0 0 0 6.5 4.3 z" to 0f) }
    val pause by lazy {
        glyph("pause", "M6.2 3.8 h3 a1.2 1.2 0 0 1 1.2 1.2 v14 a1.2 1.2 0 0 1 -1.2 1.2 h-3 A1.2 1.2 0 0 1 5 19 V5 a1.2 1.2 0 0 1 1.2 -1.2 z M14.8 3.8 h3 A1.2 1.2 0 0 1 19 5 v14 a1.2 1.2 0 0 1 -1.2 1.2 h-3 a1.2 1.2 0 0 1 -1.2 -1.2 V5 a1.2 1.2 0 0 1 1.2 -1.2 z" to 0f)
    }
    val forward by lazy {
        glyph("forward", "M1.6 6.3 v11.4 a.9 .9 0 0 0 1.4 .74 L11 12.74 a.9 .9 0 0 0 0 -1.48 L3 5.56 A.9 .9 0 0 0 1.6 6.3 z M12.2 6.3 v11.4 a.9 .9 0 0 0 1.4 .74 l8 -5.7 a.9 .9 0 0 0 0 -1.48 l-8 -5.7 A.9 .9 0 0 0 12.2 6.3 z" to 0f)
    }
    val backward by lazy {
        glyph("backward", "M22.4 6.3 v11.4 a.9 .9 0 0 1 -1.4 .74 L13 12.74 a.9 .9 0 0 1 0 -1.48 l8 -5.7 A.9 .9 0 0 1 22.4 6.3 z M11.8 6.3 v11.4 a.9 .9 0 0 1 -1.4 .74 l-8 -5.7 a.9 .9 0 0 1 0 -1.48 l8 -5.7 A.9 .9 0 0 1 11.8 6.3 z" to 0f)
    }
    val ellipsis by lazy { glyph("ellipsis", dot(5.5f, 12f, 1.8f) to 0f, dot(12f, 12f, 1.8f) to 0f, dot(18.5f, 12f, 1.8f) to 0f) }
    val lyrics by lazy {
        glyph(
            "lyrics",
            "M12 4 C6.9 4 3 7.3 3 11.4 c0 2.3 1.2 4.3 3.1 5.7 L5.4 20.3 l4 -2 c.8 .2 1.7 .3 2.6 .3 c5.1 0 9 -3.3 9 -7.3 S17.1 4 12 4 z" to 1.8f,
            "M8.4 9 h2.4 v2.5 c0 1.4 -.6 2.3 -1.9 2.8 l-.45 -.85 c.6 -.3 .95 -.8 1 -1.45 H8.4 z M13.4 9 h2.4 v2.5 c0 1.4 -.6 2.3 -1.9 2.8 l-.45 -.85 c.6 -.3 .95 -.8 1 -1.45 H13.4 z" to 0f,
        )
    }
    val queue by lazy {
        glyph("queue", "M9.5 6.5 h10.5 M9.5 12 h10.5 M9.5 17.5 h10.5" to 2f, dot(4.8f, 6.5f, 1.4f) to 0f, dot(4.8f, 12f, 1.4f) to 0f, dot(4.8f, 17.5f, 1.4f) to 0f)
    }
    val speakerLow by lazy { glyph("spk", "M3 9.5 v5 a1 1 0 0 0 1 1 h2.6 l4.2 3.6 a.8 .8 0 0 0 1.3 -.6 V5.5 a.8 .8 0 0 0 -1.3 -.6 L6.6 8.5 H4 a1 1 0 0 0 -1 1 z" to 0f) }
    val speakerHigh by lazy {
        glyph(
            "spk3",
            "M1.5 9.5 v5 a1 1 0 0 0 1 1 h2.6 l4.2 3.6 a.8 .8 0 0 0 1.3 -.6 V5.5 a.8 .8 0 0 0 -1.3 -.6 L5.1 8.5 H2.5 a1 1 0 0 0 -1 1 z" to 0f,
            "M13.6 9 a4.2 4.2 0 0 1 0 6 M16.3 6.6 a7.6 7.6 0 0 1 0 10.8 M19 4.2 a11 11 0 0 1 0 15.6" to 1.7f,
        )
    }
    val chevronR by lazy { glyph("chevR", "M9 5 l7 7 l-7 7" to 2.2f) }
    val chevronL by lazy { glyph("chevL", "M15.5 4.5 L8 12 l7.5 7.5" to 2.6f) }
    val chevronD by lazy { glyph("chevD", "M5 9 l7 7 l7 -7" to 2.4f) }
    val plus by lazy { glyph("plus", "M12 5 v14 M5 12 h14" to 2.2f) }
    val heart by lazy {
        glyph("heart", "M12 20.3 l-1.3 -1.2 C5.9 14.8 3 12.2 3 8.9 C3 6.2 5.1 4.2 7.7 4.2 c1.6 0 3.1 .7 4.3 2 c1.2 -1.3 2.7 -2 4.3 -2 c2.6 0 4.7 2 4.7 4.7 c0 3.3 -2.9 5.9 -7.7 10.2 z" to 0f)
    }
    val heartSlash by lazy {
        glyph("heartSlash", "M12 20.3 l-1.3 -1.2 C5.9 14.8 3 12.2 3 8.9 C3 6.2 5.1 4.2 7.7 4.2 c1.6 0 3.1 .7 4.3 2 c1.2 -1.3 2.7 -2 4.3 -2 c2.6 0 4.7 2 4.7 4.7 c0 3.3 -2.9 5.9 -7.7 10.2 z" to 1.8f, "M3.5 3.5 L20.5 20.5" to 1.9f)
    }
    // глазик у пароля — тот же, что на компьютере (#i-eye, #i-eye-off)
    val eye by lazy {
        glyph("eye", "M2.5 12 S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12 z" to 1.7f, dot(12f, 12f, 3f) to 1.7f)
    }
    val eyeSlash by lazy {
        glyph("eyeSlash", "M4 4 l16 16 M9.9 5.8 A9.6 9.6 0 0 1 12 5.5 c6 0 9.5 6.5 9.5 6.5 a16 16 0 0 1 -2.9 3.7 M6.3 7.6 A15.7 15.7 0 0 0 2.5 12 S6 18.5 12 18.5 a9 9 0 0 0 4 -1 M9.9 9.9 a3 3 0 0 0 4.2 4.2" to 1.7f)
    }
}
