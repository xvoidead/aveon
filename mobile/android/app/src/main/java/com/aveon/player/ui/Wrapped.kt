package com.aveon.player.ui

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Paint
import android.graphics.RectF
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.em
import androidx.core.content.FileProvider
import androidx.core.content.res.ResourcesCompat
import com.aveon.player.Engine
import com.aveon.player.Images
import com.aveon.player.R
import com.aveon.player.Wrapped
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

// Итоги года — истории: жмёшь справа — дальше, слева — назад, сами листаются через 7 секунд.
// Последняя карточка — картинка, её можно сохранить в галерею или отправить.

private const val SLIDE_MS = 7000L

private enum class Tone { Amber, Voice, Ink }

private fun plural(n: Int, one: String, few: String, many: String): String {
    val a = n % 100
    val b = n % 10
    return if (a in 11..14) many else if (b == 1) one else if (b in 2..4) few else many
}

private fun minutes(sec: Int) = "%,d".format(sec / 60).replace(',', ' ')

@Composable
fun WrappedScreen(w: Wrapped, onClose: () -> Unit) {
    val p = LocalPal.current
    val slides = remember(w) { buildSlides(w) }
    var i by remember { mutableIntStateOf(0) }
    var k by remember { mutableFloatStateOf(0f) }
    val last = i == slides.size - 1
    LaunchedEffect(i) {
        k = 0f
        if (last) { k = 1f; return@LaunchedEffect }
        val start = System.nanoTime()
        while (k < 1f) withFrameNanos { k = ((it - start) / 1e6f / SLIDE_MS).coerceAtMost(1f) }
        if (i < slides.size - 1) i++
    }
    val tone = slides[i].first
    val bg = when (tone) { Tone.Amber -> p.accent; Tone.Voice -> p.voice; Tone.Ink -> p.bg }
    val fg = when (tone) { Tone.Amber -> p.onAccent; Tone.Voice -> p.onVoice; Tone.Ink -> p.text }

    Box(
        Modifier.fillMaxSize().background(bg).pointerInput(slides.size) {
            detectTapGestures { o ->
                if (o.x < size.width / 3f) { if (i > 0) i-- } else if (i < slides.size - 1) i++ else onClose()
            }
        },
    ) {
        AnimatedContent(i, transitionSpec = { (fadeIn(tween(350)) + slideInVertically(tween(450)) { it / 12 }) togetherWith fadeOut(tween(200)) }, label = "slide") { idx ->
            Box(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(start = 26.dp, end = 26.dp, top = 56.dp, bottom = 30.dp)) {
                slides[idx].second(fg, bg)
            }
        }
        Row(Modifier.statusBarsPadding().padding(horizontal = 14.dp, vertical = 10.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            slides.indices.forEach { j ->
                Box(Modifier.weight(1f).height(3.dp).clip(CircleShape).background(fg.copy(alpha = 0.25f))) {
                    Box(Modifier.fillMaxWidth(if (j < i) 1f else if (j == i) k else 0f).fillMaxHeight().background(fg))
                }
            }
        }
        IconBtn(AIcons.close, Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(top = 18.dp, end = 6.dp), tint = fg, onClick = onClose)
    }
}

private typealias Slide = Pair<Tone, @Composable (Color, Color) -> Unit>

private fun slide(t: Tone, c: @Composable (Color, Color) -> Unit): Slide = t to c

@OptIn(ExperimentalLayoutApi::class)
private fun buildSlides(w: Wrapped): List<Slide> {
    val out = mutableListOf<Slide>()
    out += slide(Tone.Amber) { fg, _ ->
        Box(Modifier.fillMaxSize()) {
            Txt(w.year.toString(), T.display(150.sp, track = (-0.07).em), fg, Modifier.align(Alignment.TopEnd))
            Column(Modifier.align(Alignment.BottomStart)) {
                Txt("Твой ${w.year} в авеоне", T.hero, fg)
                Spacer(Modifier.height(8.dp))
                Txt("Собрали всё, что у тебя звучало. Жми, чтобы листать.", T.body, fg.copy(alpha = 0.75f))
            }
        }
    }
    out += slide(Tone.Ink) { fg, _ ->
        val p = LocalPal.current
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Bottom) {
            Txt("В этом году —", T.body, fg.copy(alpha = 0.7f))
            Txt(minutes(w.total), T.display(96.sp, track = (-0.06).em), p.accent)
            Txt(plural(w.total / 60, "минута", "минуты", "минут") + " музыки", T.hero, fg)
            Spacer(Modifier.height(10.dp))
            Txt("${w.comparison}. Музыка звучала ${w.activeDays} ${plural(w.activeDays, "день", "дня", "дней")}.", T.body, fg.copy(alpha = 0.7f))
        }
    }
    w.tracks.firstOrNull()?.let { top ->
        out += slide(Tone.Voice) { fg, _ ->
            Column(Modifier.fillMaxSize()) {
                Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                    Disc(top, true, Modifier.fillMaxWidth(0.8f).aspectRatio(1f), labelSize = 600)
                }
                Txt("Трек года", T.body, fg.copy(alpha = 0.7f))
                Txt(top.title, T.hero, fg, maxLines = 3)
                Txt("${top.artist} · ${top.plays} ${plural(top.plays, "прослушивание", "прослушивания", "прослушиваний")}", T.body, fg.copy(alpha = 0.7f))
                Spacer(Modifier.height(14.dp))
                Pill("Послушать", icon = AIcons.play) { Engine.send("wrappedPlay", org.json.JSONArray().put(top.id)) }
            }
        }
    }
    if (w.tracks.size > 1) out += slide(Tone.Ink) { fg, _ ->
        val p = LocalPal.current
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Bottom) {
            Txt("Пятёрка треков", T.hero, fg)
            Spacer(Modifier.height(18.dp))
            w.tracks.forEachIndexed { n, t ->
                Row(Modifier.padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                    Txt("${n + 1}", T.display(if (n == 0) 30.sp else 20.sp), p.accent, Modifier.width(38.dp))
                    Cover(t, Modifier.size(52.dp), 160, RoundedCornerShape(10.dp))
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Txt(t.title, T.title, fg, maxLines = 1)
                        Txt(t.artist, T.small, fg.copy(alpha = 0.6f), maxLines = 1)
                    }
                    Txt("${t.plays}", T.title, fg.copy(alpha = 0.6f))
                }
            }
            Spacer(Modifier.height(14.dp))
            Pill("Послушать", icon = AIcons.play) { Engine.send("wrappedPlay", org.json.JSONArray().apply { w.tracks.forEach { put(it.id) } }) }
        }
    }
    w.artists.firstOrNull()?.let { a ->
        out += slide(Tone.Amber) { fg, _ ->
            Column(Modifier.fillMaxSize()) {
                Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                    Img(a.cover, Modifier.fillMaxWidth(0.72f).aspectRatio(1f), 600, CircleShape) { Txt(a.name.take(1), T.display(90.sp), fg) }
                }
                Txt("Артист года", T.body, fg.copy(alpha = 0.7f))
                Txt(a.name, T.hero, fg, maxLines = 3)
                Txt("${a.share}% всего времени — ${minutes(a.sec)} мин", T.body, fg.copy(alpha = 0.7f))
            }
        }
    }
    if (w.artists.size > 1) out += slide(Tone.Voice) { fg, _ ->
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Bottom) {
            Txt("Пятёрка артистов", T.hero, fg)
            Spacer(Modifier.height(18.dp))
            w.artists.forEachIndexed { n, a ->
                Row(Modifier.padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                    Txt("${n + 1}", T.display(if (n == 0) 30.sp else 20.sp), fg, Modifier.width(38.dp))
                    Img(a.cover, Modifier.size(52.dp), 160, CircleShape) { Txt(a.name.take(1), T.h3, fg) }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Txt(a.name, T.title, fg, maxLines = 1)
                        Txt("${minutes(a.sec)} мин", T.small, fg.copy(alpha = 0.6f))
                    }
                }
            }
        }
    }
    if (w.bestDayText.isNotEmpty()) out += slide(Tone.Ink) { fg, _ ->
        val p = LocalPal.current
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Bottom) {
            Txt("Самый музыкальный день", T.body, fg.copy(alpha = 0.7f))
            Txt(w.bestDayText, T.hero, fg)
            Txt("${minutes(w.bestDaySec)} минут за один день. А лучший месяц — ${w.bestMonthName}.", T.body, fg.copy(alpha = 0.7f))
            Spacer(Modifier.height(18.dp))
            val max = (w.months.maxOrNull() ?: 1).coerceAtLeast(1)
            Row(Modifier.fillMaxWidth().height(130.dp), horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.Bottom) {
                w.months.forEachIndexed { m, v ->
                    Box(Modifier.weight(1f).fillMaxHeight(maxOf(0.03f, v.toFloat() / max)).clip(RoundedCornerShape(4.dp)).background(if (m == w.bestMonth) p.accent else fg.copy(alpha = 0.2f)))
                }
            }
        }
    }
    out += slide(Tone.Amber) { fg, _ ->
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Bottom) {
            Txt("Ты как слушатель —", T.body, fg.copy(alpha = 0.7f))
            Txt(w.persona, T.display(52.sp, track = (-0.05).em), fg)
            Spacer(Modifier.height(10.dp))
            Txt(w.personaText, T.body, fg.copy(alpha = 0.75f))
        }
    }
    out += slide(Tone.Ink) { _, _ -> FinalCard(w) }
    return out
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FinalCard(w: Wrapped) {
    val p = LocalPal.current
    val ctx = LocalContext.current
    var bmp by remember { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(w) { bmp = drawCard(ctx, w, p) }
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
            val b = bmp
            if (b == null) Spinner() else Image(b.asImageBitmap(), "Итоговая карточка", Modifier.fillMaxWidth().aspectRatio(1080f / 1350f).clip(RoundedCornerShape(18.dp)))
        }
        Spacer(Modifier.height(16.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Pill("Сохранить картинку", primary = true) { bmp?.let { saveCard(ctx, it, w.year) } }
            Pill("Поделиться", icon = AIcons.share) { bmp?.let { shareCard(ctx, it, w.year) } }
        }
    }
}

private suspend fun drawCard(ctx: Context, w: Wrapped, p: Pal): Bitmap = withContext(Dispatchers.Default) {
    val W = 1080f
    val H = 1350f
    val bmp = Bitmap.createBitmap(W.toInt(), H.toInt(), Bitmap.Config.ARGB_8888)
    val c = android.graphics.Canvas(bmp)
    val display = ResourcesCompat.getFont(ctx, R.font.unbounded_800)
    val displayBold = ResourcesCompat.getFont(ctx, R.font.unbounded_700)
    val body = ResourcesCompat.getFont(ctx, R.font.onest_500)
    c.drawColor(p.bg.toArgb())
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    // крупный год — фоном
    paint.typeface = display
    paint.textSize = 300f
    paint.color = p.accent.copy(alpha = 0.14f).toArgb()
    c.drawText(w.year.toString(), 60f, H - 50f, paint)
    // дорожки пластинки справа сверху
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = 3f
    for (k in 0 until 9) {
        paint.color = (if (k % 3 == 0) p.voice else p.accent).copy(alpha = 0.25f - k * 0.02f).toArgb()
        c.drawCircle(W - 120f, 170f, 60f + k * 26f, paint)
    }
    paint.style = Paint.Style.FILL
    val cover = w.tracks.firstOrNull()?.cover?.let { Images.load(ctx, it, 240) }
    if (cover != null) {
        val path = android.graphics.Path().apply { addCircle(W - 120f, 170f, 58f, android.graphics.Path.Direction.CW) }
        c.save(); c.clipPath(path)
        c.drawBitmap(cover, null, RectF(W - 178f, 112f, W - 62f, 228f), paint)
        c.restore()
    }
    val left = 84f
    fun text(s: String, x: Float, y: Float, size: Float, color: Color, tf: android.graphics.Typeface?, max: Float = W - x - 60f) {
        paint.typeface = tf
        paint.textSize = size
        paint.color = color.toArgb()
        var t = s
        while (t.length > 1 && paint.measureText(t) > max) t = t.dropLast(1)
        c.drawText(if (t == s) s else t.trimEnd() + "…", x, y, paint)
    }
    text("авеон · итоги ${w.year}", left, 130f, 44f, p.accent, displayBold)
    text(minutes(w.total), left, 320f, 150f, p.text, display)
    text("минут музыки", left, 380f, 40f, p.text2, body)
    val cols = listOf(Triple(left, "Треки", w.tracks.map { it.title }), Triple(W / 2 + 20f, "Артисты", w.artists.map { it.name }))
    for ((x, head, list) in cols) {
        text(head, x, 500f, 34f, p.voice, displayBold)
        list.take(5).forEachIndexed { n, s -> text("${n + 1}  $s", x, 570f + n * 62f, 36f, if (n == 0) p.text else p.text2, body, W / 2 - 110f) }
    }
    paint.color = p.accent.toArgb()
    c.drawRoundRect(RectF(left, 900f, W - left, 1070f), 36f, 36f, paint)
    text("Ты как слушатель", left + 44f, 965f, 32f, p.onAccent, body)
    text(w.persona, left + 44f, 1038f, 60f, p.onAccent, display, W - left * 2 - 88f)
    bmp
}

private fun saveCard(ctx: Context, b: Bitmap, year: Int) {
    try {
        val name = "aveon-$year.png"
        if (Build.VERSION.SDK_INT >= 29) {
            val v = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, name)
                put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/авеон")
            }
            val uri = ctx.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v) ?: throw Exception("нет доступа к галерее")
            ctx.contentResolver.openOutputStream(uri)?.use { b.compress(Bitmap.CompressFormat.PNG, 100, it) }
            Engine.toast("Картинка в галерее: Pictures/авеон")
        } else {
            shareCard(ctx, b, year) // на старых Android без разрешения в галерею не записать — отправим
        }
    } catch (e: Exception) {
        Engine.toast("Не получилось сохранить: ${e.message}", true)
    }
}

private fun shareCard(ctx: Context, b: Bitmap, year: Int) {
    try {
        val dir = File(ctx.cacheDir, "share").apply { mkdirs() }
        val f = File(dir, "aveon-$year.png")
        f.outputStream().use { b.compress(Bitmap.CompressFormat.PNG, 100, it) }
        val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".fileprovider", f)
        val send = Intent(Intent.ACTION_SEND).setType("image/png").putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        ctx.startActivity(Intent.createChooser(send, "Итоги $year").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (e: Exception) {
        Engine.toast("Не получилось отправить: ${e.message}", true)
    }
}

