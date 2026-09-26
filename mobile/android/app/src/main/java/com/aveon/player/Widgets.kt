package com.aveon.player

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Виджеты на рабочий стол: «Сейчас играет», «Волна», «Бочка», «Статистика».
 * Что показать — берём из последнего состояния плеера (сохраняем его здесь при каждом изменении),
 * кнопки — команды движку. Если приложение закрыто, кнопка открывает его и выполняет команду там.
 */
object Widgets {
    private const val PREFS = "aveon-widgets"
    private var lastKey = ""
    private var lastStats = ""
    private var coverFor = ""

    data class Snap(
        val hasTrack: Boolean, val title: String, val artist: String, val playing: Boolean, val barrel: Boolean,
        val wave: Boolean, val today: Int, val month: Int, val monthName: String, val topArtist: String,
    )

    fun read(ctx: Context): Snap {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return Snap(
            p.getBoolean("hasTrack", false), p.getString("title", "") ?: "", p.getString("artist", "") ?: "",
            p.getBoolean("playing", false), p.getBoolean("barrel", false), p.getBoolean("wave", false),
            p.getInt("today", 0), p.getInt("month", 0), p.getString("monthName", "") ?: "", p.getString("topArtist", "") ?: "",
        )
    }

    fun cover(ctx: Context): Bitmap? = File(ctx.filesDir, "widget-cover.png").takeIf { it.isFile }?.let { BitmapFactory.decodeFile(it.path) }

    fun onPlayer(ctx: Context, pl: Player) {
        val t = pl.track
        val barrel = pl.barrel > 0.5f
        val key = "${t?.id}|${pl.playing}|$barrel|${pl.wave}"
        if (key == lastKey) return
        lastKey = key
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean("hasTrack", t != null).putString("title", t?.title ?: "").putString("artist", t?.artist ?: "")
            .putBoolean("playing", pl.playing).putBoolean("barrel", barrel).putBoolean("wave", pl.wave)
            .apply()
        Engine.scope.launch {
            val url = t?.cover ?: ""
            if (url != coverFor) {
                coverFor = url
                withContext(Dispatchers.IO) {
                    val f = File(ctx.filesDir, "widget-cover.png")
                    val b = if (url.isNotEmpty()) Images.load(ctx, url, 300) else null
                    if (b == null) f.delete() else f.outputStream().use { b.compress(Bitmap.CompressFormat.PNG, 90, it) }
                }
            }
            refresh(ctx, stats = false)
        }
    }

    fun onStats(ctx: Context, s: Stats) {
        val key = "${s.today}|${s.month}|${s.artist}"
        if (key == lastStats) return
        lastStats = key
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putInt("today", s.today).putInt("month", s.month).putString("monthName", s.monthName).putString("topArtist", s.artist)
            .apply()
        Engine.scope.launch { StatsWidget().updateAll(ctx) }
    }

    private suspend fun refresh(ctx: Context, stats: Boolean) {
        try {
            NowWidget().updateAll(ctx)
            WaveWidget().updateAll(ctx)
            BarrelWidget().updateAll(ctx)
            if (stats) StatsWidget().updateAll(ctx)
        } catch (e: Exception) {
            android.util.Log.w("aveon", "widgets: ${e.message}")
        }
    }

    /** Кнопка виджета. Движок жив — команда сразу, нет — открываем приложение с этой командой. */
    suspend fun act(ctx: Context, a: String) {
        withContext(Dispatchers.Main) {
            if (Engine.ready.value) run(a)
            else ctx.startActivity(Intent(ctx, MainActivity::class.java).putExtra(EXTRA, a).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
        }
    }

    const val EXTRA = "aveon.widget"

    fun run(a: String) {
        when (a) {
            "toggle" -> Engine.send("toggle")
            "next" -> Engine.send("next")
            "prev" -> Engine.send("prev")
            "wave" -> Engine.send("waveGo")
            "barrel" -> Engine.send("barrel")
        }
    }

    /** Команда из виджета, с которой открыли приложение: выполняем, как только движок готов. */
    fun fromIntent(i: Intent?) {
        val a = i?.getStringExtra(EXTRA) ?: return
        i.removeExtra(EXTRA)
        Engine.scope.launch {
            Engine.ready.first { it }
            run(a)
        }
    }
}

val WidgetAction = ActionParameters.Key<String>("a")

class WidgetCallback : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        parameters[WidgetAction]?.let { Widgets.act(context, it) }
    }
}

private fun cmd(a: String) = actionRunCallback<WidgetCallback>(actionParametersOf(WidgetAction to a))

// ---------- оформление виджетов: тёмная плитка, янтарный акцент — как иконка приложения ----------

private val Ink = Color(0xFF1B1411)
private val Card = Color(0xFF2A201B)
private val Amber = Color(0xFFF0A63A)
private val Voice = Color(0xFF9AA8FF)
private val Text1 = Color(0xFFF4E9DC)
private val Text2 = Color(0xFFBFAE99)

private fun ts(size: Int, color: Color, bold: Boolean = false) =
    TextStyle(color = ColorProvider(color), fontSize = size.sp, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal)

@Composable
private fun Btn(res: Int, a: String, bg: Color, size: Int = 40) {
    Box(
        GlanceModifier.size(size.dp).cornerRadius((size / 2).dp).background(bg).clickable(cmd(a)),
        contentAlignment = Alignment.Center,
    ) { Image(ImageProvider(res), null, GlanceModifier.size((size * 0.5).toInt().dp)) }
}

class NowWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val s = Widgets.read(context)
        val cover = Widgets.cover(context)
        provideContent {
            Row(
                GlanceModifier.fillMaxSize().cornerRadius(24.dp).background(Ink).padding(12.dp).clickable(actionStartActivity<MainActivity>()),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (cover != null) Image(ImageProvider(cover), null, GlanceModifier.size(64.dp).cornerRadius(14.dp))
                else Box(GlanceModifier.size(64.dp).cornerRadius(14.dp).background(Card), contentAlignment = Alignment.Center) { Text("♪", style = ts(22, Text2)) }
                Spacer(GlanceModifier.width(12.dp))
                Column(GlanceModifier.defaultWeight()) {
                    Text(if (s.hasTrack) s.title else "авеон", style = ts(15, Text1, true), maxLines = 1)
                    Text(if (s.hasTrack) (if (s.barrel) "в бочке · " else "") + s.artist else "Нажми, чтобы включить музыку", style = ts(12, if (s.barrel) Voice else Text2), maxLines = 1)
                    Spacer(GlanceModifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Btn(R.drawable.ic_prev, "prev", Card, 34)
                        Spacer(GlanceModifier.width(8.dp))
                        Btn(if (s.playing) R.drawable.ic_pause else R.drawable.ic_play, "toggle", Amber, 40)
                        Spacer(GlanceModifier.width(8.dp))
                        Btn(R.drawable.ic_next, "next", Card, 34)
                    }
                }
            }
        }
    }
}

class WaveWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val s = Widgets.read(context)
        provideContent {
            Column(
                GlanceModifier.fillMaxSize().cornerRadius(24.dp).background(Amber).padding(14.dp).clickable(cmd("wave")),
                verticalAlignment = Alignment.Bottom,
            ) {
                Text("волна", style = ts(22, Ink, true))
                Text(if (s.wave && s.playing) s.title else if (s.wave) "на паузе" else "включить", style = ts(12, Ink), maxLines = 1)
                Spacer(GlanceModifier.height(8.dp))
                Btn(if (s.wave && s.playing) R.drawable.ic_pause else R.drawable.ic_play, "wave", Ink, 40)
            }
        }
    }
}

class BarrelWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val s = Widgets.read(context)
        provideContent {
            Column(
                GlanceModifier.fillMaxSize().cornerRadius(24.dp).background(if (s.barrel) Voice else Ink).padding(12.dp).clickable(cmd("barrel")),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Image(ImageProvider(if (s.barrel) R.drawable.ic_barrel_on else R.drawable.ic_barrel), null, GlanceModifier.size(36.dp))
                Spacer(GlanceModifier.height(6.dp))
                Text(if (s.barrel) "в бочке" else "бочка", style = ts(13, if (s.barrel) Ink else Text1, true))
            }
        }
    }
}

class StatsWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val s = Widgets.read(context)
        provideContent {
            Column(GlanceModifier.fillMaxSize().cornerRadius(24.dp).background(Ink).padding(14.dp).clickable(actionStartActivity<MainActivity>())) {
                Text("сегодня", style = ts(12, Text2))
                Text("${s.today} мин", style = ts(24, Amber, true))
                Spacer(GlanceModifier.height(6.dp))
                val h = s.month / 60
                Text(if (h >= 1) "в ${s.monthName.ifEmpty { "этом месяце" }} — $h ч" else "в этом месяце — ${s.month} мин", style = ts(12, Text1))
                if (s.topArtist.isNotEmpty()) Text("чаще всех: ${s.topArtist}", style = ts(12, Voice), maxLines = 1)
            }
        }
    }
}

class NowReceiver : GlanceAppWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = NowWidget() }
class WaveReceiver : GlanceAppWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = WaveWidget() }
class BarrelReceiver : GlanceAppWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = BarrelWidget() }
class StatsReceiver : GlanceAppWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = StatsWidget() }

