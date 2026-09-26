package com.aveon.player

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * Движок авеона — тот же плеер, что на компьютере (renderer/ + мост mobile/bridge), живёт в WebView
 * под Compose-экраном. Здесь его состояние (потоками) и команды к нему (NativeUI.call в renderer/native.js).
 */
object Engine {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val main = Handler(Looper.getMainLooper())
    private var web: WebView? = null
    lateinit var app: Context
        private set

    val ready = MutableStateFlow(false)
    val player = MutableStateFlow(Player())
    val theme = MutableStateFlow<Map<String, String>>(emptyMap())
    val account = MutableStateFlow(Account())
    val stats = MutableStateFlow(Stats())
    val library = MutableStateFlow(Library())
    val panels = MutableStateFlow<List<Panel>>(emptyList()) // по порядку открытия: последняя — сверху
    val menu = MutableStateFlow<Menu?>(null)
    val ask = MutableStateFlow<Ask?>(null)
    val toasts = MutableStateFlow<List<Toast>>(emptyList())
    val spectrum = MutableStateFlow(FloatArray(48))
    val opens = MutableSharedFlow<JSONObject>(extraBufferCapacity = 8) // визуализатор, итоги года
    val homeChanged = MutableSharedFlow<Unit>(extraBufferCapacity = 4)
    val reactions = MutableSharedFlow<Pair<String, String>>(extraBufferCapacity = 16) // эмодзи и кто прислал

    private val seq = AtomicInteger(0)
    private val toastSeq = AtomicLong(0)
    private val waiting = ConcurrentHashMap<Int, CompletableDeferred<Any?>>()

    fun attach(ctx: Context, view: WebView) {
        app = ctx.applicationContext
        web = view
        view.addJavascriptInterface(Bridge, "AveonUI")
    }

    fun detach() {
        web = null
        ready.value = false
    }

    // ---------- из движка ----------

    object Bridge {
        @JavascriptInterface
        fun emit(type: String, json: String) {
            try {
                handle(type, json)
            } catch (e: Exception) {
                android.util.Log.w("aveon", "emit $type: ${e.message}")
            }
        }

        @JavascriptInterface
        fun reply(id: Int, ok: Boolean, json: String) {
            val d = waiting.remove(id) ?: return
            val v = parse(json)
            if (ok) d.complete(v) else d.completeExceptionally(EngineError(v?.toString() ?: "ошибка"))
        }
    }

    class EngineError(msg: String) : Exception(msg)

    private fun parse(json: String): Any? = try {
        JSONTokener(json).nextValue().let { if (it == JSONObject.NULL) null else it }
    } catch (e: Exception) { null }

    private fun handle(type: String, json: String) {
        when (type) {
            "ready" -> ready.value = true
            "player" -> {
                val p = Player.of(JSONObject(json))
                player.value = p
                Widgets.onPlayer(app, p)
            }
            "theme" -> {
                val o = JSONObject(json)
                theme.value = o.keys().asSequence().associateWith { o.str(it) }
            }
            "account" -> JSONObject(json).let { account.value = Account(it.optBoolean("loggedIn"), it.str("name"), it.str("login"), it.str("avatar")) }
            "stats" -> JSONObject(json).let {
                val s = Stats(it.optInt("today"), it.optInt("month"), it.str("artist"), it.str("monthName"))
                stats.value = s
                Widgets.onStats(app, s)
            }
            "library" -> library.value = Library.of(JSONObject(json))
            "panel" -> {
                val p = Panel.of(JSONObject(json))
                val list = panels.value
                panels.value = if (list.any { it.key == p.key }) list.map { if (it.key == p.key) p else it } else list + p
            }
            "panelClose" -> {
                val key = parse(json) as? String ?: return
                panels.value = panels.value.filter { it.key != key }
            }
            "menu" -> menu.value = Menu.of(JSONObject(json))
            "menuClose" -> menu.value = null
            "ask" -> ask.value = Ask.of(JSONObject(json))
            "toast" -> JSONObject(json).let { o ->
                val t = Toast(toastSeq.incrementAndGet(), o.str("msg"), o.str("kind") == "err")
                toasts.value = (toasts.value + t).takeLast(3)
                main.postDelayed({ toasts.value = toasts.value.filter { it.id != t.id } }, if (t.err) 5200 else 3200)
            }
            "spec" -> {
                val parts = json.trim('"').split(',')
                spectrum.value = FloatArray(parts.size) { (parts[it].toFloatOrNull() ?: 0f) / 255f }
            }
            "open" -> opens.tryEmit(JSONObject(json))
            "homeChanged" -> homeChanged.tryEmit(Unit)
            "react" -> JSONObject(json).let { reactions.tryEmit(it.str("e") to it.str("who")) }
        }
    }

    // ---------- в движок ----------

    /** Команда движку с ответом. До готовности движка ждём его (но не вечно). */
    suspend fun call(name: String, vararg args: Any?): Any? {
        if (!ready.value) withTimeoutOrNull(30_000) { ready.first { it } } ?: return null
        val id = seq.incrementAndGet()
        val d = CompletableDeferred<Any?>()
        waiting[id] = d
        val a = JSONArray()
        for (x in args) a.put(x ?: JSONObject.NULL)
        val js = "window.NativeUI&&NativeUI.call($id,${JSONObject.quote(name)},${JSONObject.quote(a.toString())})"
        main.post { web?.evaluateJavascript(js, null) ?: waiting.remove(id)?.complete(null) }
        return withTimeoutOrNull(60_000) { d.await() }.also { waiting.remove(id) }
    }

    /** Команда без ответа: ошибку покажет сам движок (уведомлением). */
    fun send(name: String, vararg args: Any?) {
        scope.launch {
            try { call(name, *args) } catch (e: EngineError) { toast(e.message ?: "", true) }
        }
    }

    suspend fun obj(name: String, vararg args: Any?): JSONObject? = try { call(name, *args) as? JSONObject } catch (e: EngineError) { toast(e.message ?: "", true); null }

    fun toast(msg: String, err: Boolean = false) {
        val t = Toast(toastSeq.incrementAndGet(), msg, err)
        toasts.value = (toasts.value + t).takeLast(3)
        main.postDelayed({ toasts.value = toasts.value.filter { it.id != t.id } }, 3200)
    }

    // меню и диалоги движка: ответ пользователя
    fun menuPick(id: Int, index: Int) { menu.value = null; send("menuPick", id, index) }
    fun menuCancel(id: Int) { menu.value = null; send("menuCancel", id) }
    fun askDone(id: Int, result: Any?) { ask.value = null; send("askDone", id, result) }

    // панель закрыли жестом или «назад» — движок закроет её у себя и пришлёт panelClose
    fun closePanel(key: String) { send("panelClose", key) }
}
