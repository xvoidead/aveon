package com.aveon.player.ui

// Сгенерировано из <symbol> в renderer/index.html — те же значки, что на компьютере.
// Круги и прямоугольники переведены в пути, слипшиеся числа в путях — разделены.

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

class P(val d: String, val fill: Boolean, val stroke: Boolean, val width: Float, val cap: String, val join: String, val alpha: Float)

private fun icon(name: String, w: Float, h: Float, vararg parts: P): ImageVector {
    val b = ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = w, viewportHeight = h)
    for (p in parts) {
        b.addPath(
            pathData = addPathNodes(p.d),
            fill = if (p.fill) SolidColor(Color.Black) else null,
            fillAlpha = p.alpha,
            stroke = if (p.stroke) SolidColor(Color.Black) else null,
            strokeAlpha = p.alpha,
            strokeLineWidth = if (p.stroke) p.width else 0f,
            strokeLineCap = when (p.cap) { "round" -> StrokeCap.Round; "square" -> StrokeCap.Square; else -> StrokeCap.Butt },
            strokeLineJoin = when (p.join) { "round" -> StrokeJoin.Round; "bevel" -> StrokeJoin.Bevel; else -> StrokeJoin.Miter },
        )
    }
    return b.build()
}

object AIcons {
    val play: ImageVector by lazy { icon("i-play", 24f, 24f, P("M 8 5.5 v 13 a 1 1 0 0 0 1.5 .86 l 10.4 -6.5 a 1 1 0 0 0 0 -1.72 L 9.5 4.64 A 1 1 0 0 0 8 5.5 z", true, false, 1f, "butt", "miter", 1f)) }
    val pause: ImageVector by lazy { icon("i-pause", 24f, 24f, P("M7.7 5h1.6a1.2 1.2 0 0 1 1.2 1.2v11.6a1.2 1.2 0 0 1 -1.2 1.2h-1.6a1.2 1.2 0 0 1 -1.2 -1.2v-11.6a1.2 1.2 0 0 1 1.2 -1.2z", true, false, 1f, "butt", "miter", 1f), P("M14.7 5h1.6a1.2 1.2 0 0 1 1.2 1.2v11.6a1.2 1.2 0 0 1 -1.2 1.2h-1.6a1.2 1.2 0 0 1 -1.2 -1.2v-11.6a1.2 1.2 0 0 1 1.2 -1.2z", true, false, 1f, "butt", "miter", 1f)) }
    val next: ImageVector by lazy { icon("i-next", 24f, 24f, P("M 6 6.8 v 10.4 a .8 .8 0 0 0 1.25 .66 l 7.6 -5.2 a .8 .8 0 0 0 0 -1.32 l -7.6 -5.2 A .8 .8 0 0 0 6 6.8 z", true, false, 1f, "butt", "miter", 1f), P("M17.6 6h0a1.1 1.1 0 0 1 1.1 1.1v9.8a1.1 1.1 0 0 1 -1.1 1.1h0a1.1 1.1 0 0 1 -1.1 -1.1v-9.8a1.1 1.1 0 0 1 1.1 -1.1z", true, false, 1f, "butt", "miter", 1f)) }
    val prev: ImageVector by lazy { icon("i-prev", 24f, 24f, P("M 18 6.8 v 10.4 a .8 .8 0 0 1 -1.25 .66 l -7.6 -5.2 a .8 .8 0 0 1 0 -1.32 l 7.6 -5.2 A .8 .8 0 0 1 18 6.8 z", true, false, 1f, "butt", "miter", 1f), P("M6.4 6h0a1.1 1.1 0 0 1 1.1 1.1v9.8a1.1 1.1 0 0 1 -1.1 1.1h0a1.1 1.1 0 0 1 -1.1 -1.1v-9.8a1.1 1.1 0 0 1 1.1 -1.1z", true, false, 1f, "butt", "miter", 1f)) }
    val shuffle: ImageVector by lazy { icon("i-shuffle", 24f, 24f, P("M 4 7 h 3.5 c 2 0 3.2 1 4.3 2.7 l .4 .6 M 4 17 h 3.5 c 2 0 3.2 -1 4.3 -2.7 l 2.4 -3.6 C 15.3 9 16.5 7.9 18.5 7.9 H 20 M 16.8 5.2 L 19.8 8 l -3 2.8 M 16.8 13.2 l 3 2.8 l -3 2.8 M 14.5 15.4 c 1 1.3 2 1.7 4 1.7 H 20", false, true, 1.8f, "round", "round", 1f)) }
    val repeat: ImageVector by lazy { icon("i-repeat", 24f, 24f, P("M 17 3.5 L 20 6.5 l -3 3 M 20 6.5 H 8 a 4 4 0 0 0 -4 4 v 1 M 7 20.5 l -3 -3 l 3 -3 M 4 17.5 h 12 a 4 4 0 0 0 4 -4 v -1", false, true, 1.8f, "round", "round", 1f)) }
    val vol: ImageVector by lazy { icon("i-vol", 24f, 24f, P("M 4 9.5 v 5 a 1 1 0 0 0 1 1 h 3 l 4.3 3.6 a .8 .8 0 0 0 1.3 -.6 V 5.5 a .8 .8 0 0 0 -1.3 -.6 L 8 8.5 H 5 a 1 1 0 0 0 -1 1 z", true, false, 1f, "butt", "miter", 1f), P("M 16.5 8.5 a 5 5 0 0 1 0 7 M 19 6 a 8.5 8.5 0 0 1 0 12", false, true, 1.8f, "round", "miter", 1f)) }
    val mute: ImageVector by lazy { icon("i-mute", 24f, 24f, P("M 4 9.5 v 5 a 1 1 0 0 0 1 1 h 3 l 4.3 3.6 a .8 .8 0 0 0 1.3 -.6 V 5.5 a .8 .8 0 0 0 -1.3 -.6 L 8 8.5 H 5 a 1 1 0 0 0 -1 1 z", true, false, 1f, "butt", "miter", 1f), P("m 17 9.5 l 5 5 m 0 -5 l -5 5", false, true, 1.8f, "round", "miter", 1f)) }
    val soundcloud: ImageVector by lazy { icon("i-soundcloud", 24f, 24f, P("M 9.5 17.5 V 9.2 a 5.3 5.3 0 0 1 9.9 2.4 a 3 3 0 1 1 .6 5.9 H 9.5 z", false, true, 1.7f, "butt", "round", 1f), P("M 3.5 16 v -2.5 M 6.5 17.5 v -6", false, true, 1.7f, "round", "miter", 1f)) }
    val search: ImageVector by lazy { icon("i-search", 24f, 24f, P("M4.5 11a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0 -13 0z", false, true, 1.8f, "butt", "miter", 1f), P("m 16 16 l 4 4", true, true, 1.8f, "round", "miter", 1f)) }
    val settings: ImageVector by lazy { icon("i-settings", 24f, 24f, P("M 12.22 2 h -.44 a 2 2 0 0 0 -2 2 v .18 a 2 2 0 0 1 -1 1.73 l -.43 .25 a 2 2 0 0 1 -2 0 l -.15 -.08 a 2 2 0 0 0 -2.73 .73 l -.22 .38 a 2 2 0 0 0 .73 2.73 l .15 .1 a 2 2 0 0 1 1 1.72 v .51 a 2 2 0 0 1 -1 1.74 l -.15 .09 a 2 2 0 0 0 -.73 2.73 l .22 .38 a 2 2 0 0 0 2.73 .73 l .15 -.08 a 2 2 0 0 1 2 0 l .43 .25 a 2 2 0 0 1 1 1.73 V 20 a 2 2 0 0 0 2 2 h .44 a 2 2 0 0 0 2 -2 v -.18 a 2 2 0 0 1 1 -1.73 l .43 -.25 a 2 2 0 0 1 2 0 l .15 .08 a 2 2 0 0 0 2.73 -.73 l .22 -.39 a 2 2 0 0 0 -.73 -2.73 l -.15 -.08 a 2 2 0 0 1 -1 -1.74 v -.5 a 2 2 0 0 1 1 -1.74 l .15 -.09 a 2 2 0 0 0 .73 -2.73 l -.22 -.38 a 2 2 0 0 0 -2.73 -.73 l -.15 .08 a 2 2 0 0 1 -2 0 l -.43 -.25 a 2 2 0 0 1 -1 -1.73 V 4 a 2 2 0 0 0 -2 -2 z", false, true, 1.7f, "round", "round", 1f), P("M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0z", false, true, 1.7f, "butt", "miter", 1f)) }
    val close: ImageVector by lazy { icon("i-close", 24f, 24f, P("m 6.5 6.5 l 11 11 m 0 -11 l -11 11", true, true, 1.6f, "round", "miter", 1f)) }
    val plus: ImageVector by lazy { icon("i-plus", 24f, 24f, P("M 12 5.5 v 13 M 5.5 12 h 13", true, true, 1.8f, "round", "miter", 1f)) }
    val refresh: ImageVector by lazy { icon("i-refresh", 24f, 24f, P("M 19.5 12 a 7.5 7.5 0 1 1 -2.2 -5.3 M 19.5 4.5 v 4 h -4", false, true, 1.8f, "round", "round", 1f)) }
    val disk: ImageVector by lazy { icon("i-disk", 24f, 24f, P("M4.5 6.5a7.5 3 0 1 0 15 0a7.5 3 0 1 0 -15 0z", false, true, 1.7f, "butt", "miter", 1f), P("M 4.5 6.5 v 11 c 0 1.7 3.4 3 7.5 3 s 7.5 -1.3 7.5 -3 v -11 M 4.5 12 c 0 1.7 3.4 3 7.5 3 s 7.5 -1.3 7.5 -3", false, true, 1.7f, "butt", "miter", 1f)) }
    val download: ImageVector by lazy { icon("i-download", 24f, 24f, P("M 12 4.5 v 10 m 0 0 l -4 -4 m 4 4 l 4 -4 M 5 18.5 h 14", false, true, 1.8f, "round", "round", 1f)) }
    val heart: ImageVector by lazy { icon("i-heart", 24f, 24f, P("M 12 19.5 s -7 -4.3 -7 -9.6 A 4 4 0 0 1 12 7.6 a 4 4 0 0 1 7 2.3 c 0 5.3 -7 9.6 -7 9.6 z", false, true, 1.8f, "butt", "round", 1f)) }
    val dislike: ImageVector by lazy { icon("i-dislike", 24f, 24f, P("M4.5 12a7.5 7.5 0 1 0 15 0a7.5 7.5 0 1 0 -15 0z", false, true, 1.8f, "butt", "miter", 1f), P("m 7 17 l 10 -10", true, true, 1.8f, "round", "miter", 1f)) }
    val check: ImageVector by lazy { icon("i-check", 24f, 24f, P("m 5.5 12.5 l 4.2 4.2 l 8.8 -9.4", false, true, 2f, "round", "round", 1f)) }
    val moon: ImageVector by lazy { icon("i-moon", 24f, 24f, P("M 19.5 14.2 A 7.5 7.5 0 0 1 9.8 4.5 a 7.5 7.5 0 1 0 9.7 9.7 z", false, true, 1.6f, "butt", "round", 1f)) }
    val alarm: ImageVector by lazy { icon("i-alarm", 24f, 24f, P("M5 13a7 7 0 1 0 14 0a7 7 0 1 0 -14 0z", false, true, 1.6f, "butt", "miter", 1f), P("M 12 9.5 V 13 l 2.3 1.6 M 4.5 5.5 l 3 -2.3 M 19.5 5.5 l -3 -2.3", false, true, 1.6f, "round", "miter", 1f)) }
    val focus: ImageVector by lazy { icon("i-focus", 24f, 24f, P("M4.5 12a7.5 7.5 0 1 0 15 0a7.5 7.5 0 1 0 -15 0z", false, true, 1.6f, "butt", "miter", 1f), P("M8.5 12a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0z", false, true, 1.6f, "butt", "miter", 1f), P("M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0z", true, false, 1f, "butt", "miter", 1f)) }
    val mic: ImageVector by lazy { icon("i-mic", 24f, 24f, P("M12 3.5h0a3 3 0 0 1 3 3v4.5a3 3 0 0 1 -3 3h0a3 3 0 0 1 -3 -3v-4.5a3 3 0 0 1 3 -3z", false, true, 1.6f, "butt", "miter", 1f), P("M 6 11.5 a 6 6 0 0 0 12 0 M 12 17.5 v 3", false, true, 1.6f, "round", "miter", 1f)) }
    val viz: ImageVector by lazy { icon("i-viz", 24f, 24f, P("M 4 12 h 2 l 2 -5 l 3 10 l 3 -13 l 3 11 l 1.5 -3 H 20", false, true, 1.6f, "round", "round", 1f)) }
    val blank: ImageVector by lazy { icon("i-blank", 24f, 24f, ) }
    val folder: ImageVector by lazy { icon("i-folder", 24f, 24f, P("M 3.5 7.5 a 2 2 0 0 1 2 -2 h 4 l 2 2 h 7 a 2 2 0 0 1 2 2 v 7.5 a 2 2 0 0 1 -2 2 h -13 a 2 2 0 0 1 -2 -2 z", false, true, 1.7f, "butt", "round", 1f)) }
    val more: ImageVector by lazy { icon("i-more", 24f, 24f, P("M4.3 12a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0 -3.4 0z", true, false, 1f, "butt", "miter", 1f), P("M10.3 12a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0 -3.4 0z", true, false, 1f, "butt", "miter", 1f), P("M16.3 12a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0 -3.4 0z", true, false, 1f, "butt", "miter", 1f)) }
    val albumAdd: ImageVector by lazy { icon("i-album-add", 24f, 24f, P("M 4 6.5 h 11 M 4 11.5 h 11 M 4 16.5 h 6", true, true, 1.8f, "round", "miter", 1f), P("M 17.5 13 v 7 M 14 16.5 h 7", true, true, 1.8f, "round", "miter", 1f)) }
    val pencil: ImageVector by lazy { icon("i-pencil", 24f, 24f, P("M 5 19 l 1 -4 l 9.5 -9.5 a 2.1 2.1 0 0 1 3 3 L 9 18 z", false, true, 1.7f, "butt", "round", 1f)) }
    val trash: ImageVector by lazy { icon("i-trash", 24f, 24f, P("M 5 7 h 14 M 10 7 V 5 h 4 v 2 M 7 7 l 1 12 h 8 l 1 -12", false, true, 1.7f, "round", "round", 1f)) }
    val grip: ImageVector by lazy { icon("i-grip", 24f, 24f, P("M7.6 7a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0z", true, false, 1f, "butt", "miter", 1f), P("M13.6 7a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0z", true, false, 1f, "butt", "miter", 1f), P("M7.6 12a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0z", true, false, 1f, "butt", "miter", 1f), P("M13.6 12a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0z", true, false, 1f, "butt", "miter", 1f), P("M7.6 17a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0z", true, false, 1f, "butt", "miter", 1f), P("M13.6 17a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0z", true, false, 1f, "butt", "miter", 1f)) }
    val user: ImageVector by lazy { icon("i-user", 24f, 24f, P("M8.2 8.5a3.8 3.8 0 1 0 7.6 0a3.8 3.8 0 1 0 -7.6 0z", false, true, 1.8f, "butt", "miter", 1f), P("M 4.8 19.5 c 1.2 -3.2 4 -4.8 7.2 -4.8 s 6 1.6 7.2 4.8", false, true, 1.8f, "round", "miter", 1f)) }
    val full: ImageVector by lazy { icon("i-full", 24f, 24f, P("M 4.5 9 V 5.5 a 1 1 0 0 1 1 -1 H 9 M 15 4.5 h 3.5 a 1 1 0 0 1 1 1 V 9 M 19.5 15 v 3.5 a 1 1 0 0 1 -1 1 H 15 M 9 19.5 H 5.5 a 1 1 0 0 1 -1 -1 V 15", false, true, 1.8f, "round", "round", 1f)) }
    val eq: ImageVector by lazy { icon("i-eq", 24f, 24f, P("M 6 4 v 16 M 12 4 v 16 M 18 4 v 16", true, true, 1.6f, "round", "miter", .45f), P("M 3.8 14 h 4.4 M 9.8 8 h 4.4 M 15.8 12 h 4.4", true, true, 2.4f, "round", "miter", 1f)) }
    val lyrics: ImageVector by lazy { icon("i-lyrics", 24f, 24f, P("M 4 6 h 10 M 4 10.5 h 13 M 4 15 h 8", true, true, 1.8f, "round", "miter", 1f), P("M 16.5 20 a 2 2 0 1 1 0 -4 a 2 2 0 0 1 0 4 z m 2 -2 v -6.5 l 2.5 .8", false, true, 1.6f, "round", "round", 1f)) }
    val stats: ImageVector by lazy { icon("i-stats", 24f, 24f, P("M 5 19 V 11 M 10 19 V 5 M 15 19 v -7 M 20 19 V 9", true, true, 2f, "round", "miter", 1f)) }
    val friends: ImageVector by lazy { icon("i-friends", 24f, 24f, P("M5.9 8.5a3.6 3.6 0 1 0 7.2 0a3.6 3.6 0 1 0 -7.2 0z", false, true, 1.8f, "butt", "miter", 1f), P("M 3.5 19.5 c 1 -3.1 3.4 -4.7 6 -4.7 c 1.5 0 2.9 .5 4 1.5", false, true, 1.8f, "round", "miter", 1f), P("M 19 11.5 v 6.2", false, true, 1.8f, "round", "miter", 1f), P("M 19 11.5 l 2.3 .9", false, true, 1.8f, "round", "miter", 1f), P("M15.4 18a1.9 1.6 0 1 0 3.8 0a1.9 1.6 0 1 0 -3.8 0z", true, false, 1f, "butt", "miter", 1f)) }
    val chat: ImageVector by lazy { icon("i-chat", 24f, 24f, P("M 5 5.5 h 14 a 1.5 1.5 0 0 1 1.5 1.5 v 8.5 a 1.5 1.5 0 0 1 -1.5 1.5 h -7.5 L 7 20.5 V 17 H 5 a 1.5 1.5 0 0 1 -1.5 -1.5 V 7 A 1.5 1.5 0 0 1 5 5.5 z", false, true, 1.8f, "butt", "round", 1f)) }
    val enter: ImageVector by lazy { icon("i-enter", 24f, 24f, P("M 13.5 4.5 h 4 a 1.5 1.5 0 0 1 1.5 1.5 v 12 a 1.5 1.5 0 0 1 -1.5 1.5 h -4 M 4.5 12 h 10 M 11 8.5 l 3.5 3.5 l -3.5 3.5", false, true, 1.8f, "round", "round", 1f)) }
    val together: ImageVector by lazy { icon("i-together", 24f, 24f, P("M5.8 8.5a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0 -6.4 0z", false, true, 1.7f, "butt", "miter", 1f), P("M 3.5 19 c .6 -3 2.8 -4.6 5.5 -4.6 s 4.9 1.6 5.5 4.6", false, true, 1.7f, "round", "miter", 1f), P("M 15.2 5.6 a 3.2 3.2 0 0 1 0 5.8 M 17.3 14.6 c 1.7 .6 2.8 2 3.2 4.4", false, true, 1.7f, "round", "miter", 1f)) }
    val copy: ImageVector by lazy { icon("i-copy", 24f, 24f, P("M10.7 8.5h6.6a2.2 2.2 0 0 1 2.2 2.2v6.6a2.2 2.2 0 0 1 -2.2 2.2h-6.6a2.2 2.2 0 0 1 -2.2 -2.2v-6.6a2.2 2.2 0 0 1 2.2 -2.2z", false, true, 1.7f, "butt", "miter", 1f), P("M 15.5 8.5 V 6.7 a 2.2 2.2 0 0 0 -2.2 -2.2 H 6.7 a 2.2 2.2 0 0 0 -2.2 2.2 v 6.6 a 2.2 2.2 0 0 0 2.2 2.2 h 1.8", false, true, 1.7f, "butt", "miter", 1f)) }
    val chevronL: ImageVector by lazy { icon("i-chevron-l", 24f, 24f, P("m 14.5 6 l -6 6 l 6 6", false, true, 1.8f, "round", "round", 1f)) }
    val chevronR: ImageVector by lazy { icon("i-chevron-r", 24f, 24f, P("m 9.5 6 l 6 6 l -6 6", false, true, 1.8f, "round", "round", 1f)) }
    val list: ImageVector by lazy { icon("i-list", 24f, 24f, P("M 9 6.5 h 11 M 9 12 h 11 M 9 17.5 h 11", true, true, 1.8f, "round", "miter", 1f), P("M3.5 6.5a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0z", true, false, 1f, "butt", "miter", 1f), P("M3.5 12a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0z", true, false, 1f, "butt", "miter", 1f), P("M3.5 17.5a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0z", true, false, 1f, "butt", "miter", 1f)) }
    val share: ImageVector by lazy { icon("i-share", 24f, 24f, P("M 12 14.5 V 4 m 0 0 L 8 8 m 4 -4 l 4 4", false, true, 1.8f, "round", "round", 1f), P("M 8.5 11 H 7 a 2 2 0 0 0 -2 2 v 5 a 2 2 0 0 0 2 2 h 10 a 2 2 0 0 0 2 -2 v -5 a 2 2 0 0 0 -2 -2 h -1.5", false, true, 1.8f, "round", "miter", 1f)) }
    val code: ImageVector by lazy { icon("i-code", 24f, 24f, P("M6 6h12a2.5 2.5 0 0 1 2.5 2.5v7a2.5 2.5 0 0 1 -2.5 2.5h-12a2.5 2.5 0 0 1 -2.5 -2.5v-7a2.5 2.5 0 0 1 2.5 -2.5z", false, true, 1.7f, "butt", "miter", 1f), P("M 7.5 10.5 v 3 M 10.5 10.5 v 3 M 13.5 10.5 v 3 M 16.5 10.5 v 3", true, true, 1.7f, "round", "miter", 1f)) }
    val device: ImageVector by lazy { icon("i-device", 24f, 24f, P("M5.5 5h13a2 2 0 0 1 2 2v7a2 2 0 0 1 -2 2h-13a2 2 0 0 1 -2 -2v-7a2 2 0 0 1 2 -2z", false, true, 1.7f, "butt", "miter", 1f), P("M 8.5 19.5 h 7 M 12 16 v 3.5", true, true, 1.7f, "round", "miter", 1f)) }
    val palette: ImageVector by lazy { icon("i-palette", 24f, 24f, P("M 12 3.8 a 8.2 8.2 0 1 0 0 16.4 c 1.1 0 1.7 -.7 1.7 -1.5 c 0 -.9 -.8 -1.3 -.8 -2.2 c 0 -.9 .7 -1.6 1.6 -1.6 h 2.1 a 3.6 3.6 0 0 0 3.6 -3.6 c 0 -4.2 -3.7 -7.5 -8.2 -7.5 z", false, true, 1.7f, "butt", "miter", 1f), P("M6.6 11a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0 -2.4 0z", true, false, 1f, "butt", "miter", 1f), P("M9.3 7.4a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0 -2.4 0z", true, false, 1f, "butt", "miter", 1f), P("M13.8 7.8a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0 -2.4 0z", true, false, 1f, "butt", "miter", 1f)) }
    val phone: ImageVector by lazy { icon("i-phone", 24f, 24f, P("M 5 4.5 h 3.2 l 1.6 4 l -2.1 1.3 a 10 10 0 0 0 6.5 6.5 l 1.3 -2.1 l 4 1.6 V 19 a 1.5 1.5 0 0 1 -1.6 1.5 A 15.5 15.5 0 0 1 3.5 6.1 A 1.5 1.5 0 0 1 5 4.5 z", false, true, 1.7f, "butt", "round", 1f)) }
    val shield: ImageVector by lazy { icon("i-shield", 24f, 24f, P("M 12 3.5 L 5 6.2 v 5.3 c 0 4.3 2.9 7.8 7 9 c 4.1 -1.2 7 -4.7 7 -9 V 6.2 z", false, true, 1.7f, "butt", "round", 1f), P("m 9 12 l 2.2 2.2 L 15.5 10", false, true, 1.7f, "round", "round", 1f)) }
    val plug: ImageVector by lazy { icon("i-plug", 24f, 24f, P("M 9 3.5 v 4 M 15 3.5 v 4 M 6.5 7.5 h 11 v 3.5 a 5.5 5.5 0 0 1 -11 0 z M 12 16.5 v 4", false, true, 1.7f, "round", "round", 1f)) }
    val keys: ImageVector by lazy { icon("i-keys", 24f, 24f, P("M5.2 6.5h13.6a2.2 2.2 0 0 1 2.2 2.2v6.6a2.2 2.2 0 0 1 -2.2 2.2h-13.6a2.2 2.2 0 0 1 -2.2 -2.2v-6.6a2.2 2.2 0 0 1 2.2 -2.2z", false, true, 1.7f, "butt", "miter", 1f), P("M 7 10.5 h .01 M 10.3 10.5 h .01 M 13.7 10.5 h .01 M 17 10.5 h .01 M 8 14 h 8", true, true, 1.9f, "round", "miter", 1f)) }
    val min: ImageVector by lazy { icon("i-min", 24f, 24f, P("M 6 12 h 12", true, true, 1.3f, "butt", "miter", 1f)) }
    val max: ImageVector by lazy { icon("i-max", 24f, 24f, P("M8 6.5h8a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1 -1.5 1.5h-8a1.5 1.5 0 0 1 -1.5 -1.5v-8a1.5 1.5 0 0 1 1.5 -1.5z", false, true, 1.3f, "butt", "miter", 1f)) }

    // Значок по id из разметки движка ("i-play" и т. п.)
    fun byId(id: String?): ImageVector? = when (id?.removePrefix("#")) {
        "i-play" -> play
        "i-pause" -> pause
        "i-next" -> next
        "i-prev" -> prev
        "i-shuffle" -> shuffle
        "i-repeat" -> repeat
        "i-vol" -> vol
        "i-mute" -> mute
        "i-soundcloud" -> soundcloud
        "i-search" -> search
        "i-settings" -> settings
        "i-close" -> close
        "i-plus" -> plus
        "i-refresh" -> refresh
        "i-disk" -> disk
        "i-download" -> download
        "i-heart" -> heart
        "i-dislike" -> dislike
        "i-check" -> check
        "i-moon" -> moon
        "i-alarm" -> alarm
        "i-focus" -> focus
        "i-mic" -> mic
        "i-viz" -> viz
        "i-blank" -> blank
        "i-folder" -> folder
        "i-more" -> more
        "i-album-add" -> albumAdd
        "i-pencil" -> pencil
        "i-trash" -> trash
        "i-grip" -> grip
        "i-user" -> user
        "i-full" -> full
        "i-eq" -> eq
        "i-lyrics" -> lyrics
        "i-stats" -> stats
        "i-friends" -> friends
        "i-chat" -> chat
        "i-enter" -> enter
        "i-together" -> together
        "i-copy" -> copy
        "i-chevron-l" -> chevronL
        "i-chevron-r" -> chevronR
        "i-list" -> list
        "i-share" -> share
        "i-code" -> code
        "i-device" -> device
        "i-palette" -> palette
        "i-phone" -> phone
        "i-shield" -> shield
        "i-plug" -> plug
        "i-keys" -> keys
        "i-min" -> min
        "i-max" -> max
        else -> null
    }
}
