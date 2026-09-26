package com.aveon.player

import org.json.JSONArray
import org.json.JSONObject

// Данные, которые присылает движок (renderer/native.js). JSON разбираем вручную — без лишних библиотек.

fun JSONObject.str(k: String): String = if (isNull(k)) "" else optString(k, "")
fun JSONObject.objOrNull(k: String): JSONObject? = if (isNull(k)) null else optJSONObject(k)
fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }
fun JSONArray?.strings(): List<String> = if (this == null) emptyList() else (0 until length()).map { optString(it, "") }

data class Track(
    val id: String,
    val title: String,
    val artist: String,
    val album: String,
    val duration: Double,
    val cover: String,
    val source: String,
    val playable: Boolean,
    val preview: Boolean,
    val dl: Boolean,
    val plays: Int = 0,
) {
    companion object {
        fun of(o: JSONObject?): Track? = o?.let {
            Track(
                id = it.str("id"), title = it.str("title"), artist = it.str("artist"), album = it.str("album"),
                duration = it.optDouble("duration", 0.0).let { d -> if (d.isNaN()) 0.0 else d },
                cover = it.str("cover"), source = it.str("source"), playable = it.optBoolean("playable", true),
                preview = it.optBoolean("preview"), dl = it.optBoolean("dl"), plays = it.optInt("plays", 0),
            )
        }
        fun list(a: JSONArray?): List<Track> = a.objects().mapNotNull { of(it) }
    }
}

data class Focus(val phase: String, val left: Int, val paused: Boolean, val round: Int)
data class Room(val code: String, val connected: Boolean, val members: List<String>)

data class Player(
    val track: Track? = null,
    val playing: Boolean = false,
    val pos: Double = 0.0,
    val dur: Double = 0.0,
    val at: Long = 0,
    val volume: Double = 1.0,
    val muted: Boolean = false,
    val shuffle: Boolean = false,
    val repeat: String = "off",
    val via: String = "",
    val barrel: Float = 0f,
    val manual: Boolean = false,
    val call: Boolean = false,
    val duckOn: Boolean = false,
    val wave: Boolean = false,
    val waveLoading: Boolean = false,
    val dj: Boolean = false,
    val karaoke: Boolean = false,
    val sleep: Int = 0,
    val focus: Focus? = null,
    val room: Room? = null,
    val friendsBadge: Boolean = false,
    val locked: Boolean = false,
    val hasQueue: Boolean = false,
) {
    /** Позиция сейчас: движок присылает её раз в секунду, между присылками досчитываем сами. */
    fun posNow(now: Long = System.currentTimeMillis()): Double =
        if (playing) minOf(dur.takeIf { it > 0 } ?: Double.MAX_VALUE, pos + (now - at) / 1000.0) else pos

    companion object {
        fun of(o: JSONObject): Player = Player(
            track = Track.of(o.objOrNull("track")),
            playing = o.optBoolean("playing"),
            pos = o.optDouble("pos", 0.0),
            dur = o.optDouble("dur", 0.0),
            at = System.currentTimeMillis(),
            volume = o.optDouble("volume", 1.0),
            muted = o.optBoolean("muted"),
            shuffle = o.optBoolean("shuffle"),
            repeat = o.optString("repeat", "off"),
            via = o.str("via"),
            barrel = o.optDouble("barrel", 0.0).toFloat(),
            manual = o.optBoolean("manual"),
            call = o.optBoolean("call"),
            duckOn = o.optBoolean("duckOn"),
            wave = o.optBoolean("wave"),
            waveLoading = o.optBoolean("waveLoading"),
            dj = o.optBoolean("dj"),
            karaoke = o.optBoolean("karaoke"),
            sleep = o.optInt("sleep", 0),
            focus = o.objOrNull("focus")?.let { Focus(it.str("phase"), it.optInt("left"), it.optBoolean("paused"), it.optInt("round", 1)) },
            room = o.objOrNull("room")?.let { Room(it.str("code"), it.optBoolean("connected", true), it.optJSONArray("members").strings()) },
            friendsBadge = o.optBoolean("friendsBadge"),
            locked = o.optBoolean("locked"),
            hasQueue = o.optBoolean("hasQueue"),
        )
    }
}

data class Account(val loggedIn: Boolean = false, val name: String = "", val login: String = "", val avatar: String = "")

data class Stats(val today: Int = 0, val month: Int = 0, val artist: String = "", val monthName: String = "")

// ---------- библиотека ----------

data class Chip(val label: String, val active: Boolean, val icon: String, val cover: String, val count: String)
data class Action(val s: String, val label: String, val icon: String, val primary: Boolean, val disabled: Boolean)
data class Empty(val title: String, val text: String, val loading: Boolean, val actions: List<Action>)
data class Card(val id: Int, val img: String, val title: String, val sub: String, val badge: String, val letter: String, val round: Boolean)
data class HeroButton(val id: Int, val s: String, val icon: String, val primary: Boolean, val disabled: Boolean)

sealed class Block {
    data class Rows(val from: Int, val n: Int) : Block()
    data class Head(val s: String, val count: String) : Block()
    data class Grid(val items: List<Card>) : Block()
    data class Strip(val items: List<Card>) : Block()
    data class Hero(val name: String, val stats: String, val meta: String, val img: String, val banner: String, val buttons: List<HeroButton>) : Block()
    data class Group(val img: String, val title: String, val sub: String, val play: Int) : Block()
    data class Loading(val s: String) : Block()
    data class Para(val s: String) : Block()
}

data class Library(
    val view: String = "",
    val sub: String = "",
    val title: String = "",
    val sub2: String = "",
    val placeholder: String = "",
    val query: String = "",
    val chips: List<Chip> = emptyList(),
    val actions: List<Action> = emptyList(),
    val empty: Empty? = null,
    val blocks: List<Block> = emptyList(),
    val tracks: List<Track> = emptyList(),
    val reorder: Boolean = false,
) {
    companion object {
        private fun card(o: JSONObject) = Card(o.optInt("id"), o.str("img"), o.str("title"), o.str("sub"), o.str("badge"), o.str("letter"), o.optBoolean("round"))
        private fun action(o: JSONObject) = Action(o.str("s"), o.str("label"), o.str("icon"), o.optBoolean("primary"), o.optBoolean("disabled"))

        fun of(root: JSONObject): Library {
            val o = root.getJSONObject("snap")
            val blocks = o.optJSONArray("blocks").objects().mapNotNull { b ->
                when (b.str("t")) {
                    "rows" -> Block.Rows(b.optInt("from"), b.optInt("n"))
                    "h" -> Block.Head(b.str("s"), b.str("count"))
                    "grid" -> Block.Grid(b.optJSONArray("items").objects().map(::card))
                    "row" -> Block.Strip(b.optJSONArray("items").objects().map(::card))
                    "hero" -> Block.Hero(
                        b.str("name"), b.str("stats"), b.str("meta"), b.str("img"), b.str("banner"),
                        b.optJSONArray("buttons").objects().map { HeroButton(it.optInt("id"), it.str("s"), it.str("icon"), it.optBoolean("primary"), it.optBoolean("disabled")) },
                    )
                    "group" -> Block.Group(b.str("img"), b.str("title"), b.str("sub"), b.optInt("play"))
                    "loading" -> Block.Loading(b.str("s"))
                    "p" -> Block.Para(b.str("s"))
                    else -> null
                }
            }
            return Library(
                view = o.str("view"), sub = o.str("sub"), title = o.str("title"), sub2 = o.str("sub2"),
                placeholder = o.str("placeholder"), query = o.str("query"),
                chips = o.optJSONArray("chips").objects().map { Chip(it.str("label"), it.optBoolean("active"), it.str("icon"), it.str("cover"), it.str("count")) },
                actions = o.optJSONArray("actions").objects().map(::action),
                empty = o.objOrNull("empty")?.let { e -> Empty(e.str("title"), e.str("text"), e.optBoolean("loading"), e.optJSONArray("actions").objects().map(::action)) },
                blocks = blocks,
                tracks = Track.list(root.optJSONArray("tracks")),
                reorder = o.optBoolean("reorder"),
            )
        }
    }
}

// ---------- меню, диалоги, панели ----------

data class MenuItem(val label: String, val icon: String, val count: String, val danger: Boolean, val muted: Boolean, val sep: Boolean, val note: String)
data class Menu(val id: Int, val items: List<MenuItem>) {
    companion object {
        fun of(o: JSONObject) = Menu(o.optInt("id"), o.optJSONArray("items").objects().map {
            MenuItem(it.str("label"), it.str("icon"), it.str("count"), it.optBoolean("danger"), it.optBoolean("muted"), it.optBoolean("sep"), it.str("note"))
        })
    }
}

data class Ask(val id: Int, val title: String, val text: String, val value: String, val ok: String, val input: Boolean, val danger: Boolean, val password: Boolean) {
    companion object {
        fun of(o: JSONObject) = Ask(o.optInt("id"), o.str("title"), o.str("text"), o.str("value"), o.optString("ok", "Готово"), o.optBoolean("input", true), o.optBoolean("danger"), o.optBoolean("password"))
    }
}

data class Toast(val id: Long, val msg: String, val err: Boolean)

/** Узел «зеркала» панели: тип (h, p, text, img, btn, switch, range, input, select, seg, field, nav, list, box, form) и его поля. */
class MNode(val t: String, val o: JSONObject, val kids: List<MNode>) {
    val id: Int get() = o.optInt("id")
    val s: String get() = o.str("s")
    val cls: String get() = o.str("cls")
    fun has(c: String) = cls.split(' ').contains(c)

    companion object {
        fun of(o: JSONObject): MNode = MNode(o.str("t"), o, list(o.optJSONArray("kids")))
        fun list(a: JSONArray?): List<MNode> = a.objects().map(::of)
    }
}

data class Panel(val key: String, val title: String, val closable: Boolean, val kids: List<MNode>) {
    companion object {
        fun of(o: JSONObject) = Panel(o.str("key"), o.str("title"), o.optBoolean("closable", true), MNode.list(o.optJSONArray("kids")))
    }
}

// ---------- главная, волна, текст, эквалайзер ----------

data class HomeList(val title: String, val meta: String, val cover: String, val icon: String)
data class HomeArtist(val name: String, val cover: String)
data class HomeFriend(val id: Int, val name: String, val title: String, val artist: String, val cover: String)
data class Home(
    val greeting: String = "",
    val line: String = "",
    val waveYm: Boolean = false,
    val waveNote: String = "",
    val tracks: List<Track> = emptyList(),
    val lists: List<HomeList> = emptyList(),
    val artists: List<HomeArtist> = emptyList(),
    val friends: List<HomeFriend> = emptyList(),
    val wrapped: Int = 0,
) {
    companion object {
        fun of(o: JSONObject): Home {
            val w = o.optJSONObject("wave") ?: JSONObject()
            return Home(
                greeting = o.str("greeting"), line = o.str("line"), waveYm = w.optBoolean("ym"), waveNote = w.str("note"),
                tracks = Track.list(o.optJSONArray("tracks")),
                lists = o.optJSONArray("lists").objects().map { HomeList(it.str("title"), it.str("meta"), it.str("cover"), it.str("icon")) },
                artists = o.optJSONArray("artists").objects().map { HomeArtist(it.str("name"), it.str("cover")) },
                friends = o.optJSONArray("friends").objects().map { HomeFriend(it.optInt("id"), it.str("name"), it.str("title"), it.str("artist"), it.str("cover")) },
                wrapped = o.optInt("wrapped"),
            )
        }
    }
}

data class WaveOpt(val v: String, val s: String)
data class WaveWord(val key: String, val title: String, val cur: String, val opts: List<WaveOpt>)
data class WaveState(val ym: Boolean = false, val active: Boolean = false, val loading: Boolean = false, val playing: Boolean = false, val words: List<WaveWord> = emptyList(), val upcoming: List<Track> = emptyList()) {
    companion object {
        fun of(o: JSONObject) = WaveState(
            ym = o.optBoolean("ym"), active = o.optBoolean("active"), loading = o.optBoolean("loading"), playing = o.optBoolean("playing"),
            words = o.optJSONArray("words").objects().map { w ->
                WaveWord(w.str("key"), w.str("title"), w.str("cur"), w.optJSONArray("opts").objects().map { WaveOpt(it.str("v"), it.str("s")) })
            },
            upcoming = Track.list(o.optJSONArray("upcoming")),
        )
    }
}

data class LyricWord(val t: Double, val s: String)
data class LyricLine(val t: Double, val s: String, val words: List<LyricWord>?)
data class Lyrics(val id: String, val from: String, val lines: List<LyricLine>, val plain: String, val instrumental: Boolean, val none: Boolean, val error: String = "") {
    val synced get() = lines.isNotEmpty()

    companion object {
        fun of(o: JSONObject): Lyrics {
            val lines = when {
                o.has("words") -> o.optJSONArray("words").objects().map { l ->
                    val words = l.optJSONArray("w").objects().map { LyricWord(it.optDouble("t"), it.str("s")) }
                    LyricLine(l.optDouble("t"), joinWords(words), words)
                }
                o.has("lines") -> o.optJSONArray("lines").objects().map { LyricLine(it.optDouble("t"), it.str("s"), null) }
                else -> emptyList()
            }
            return Lyrics(o.str("id"), o.str("from"), lines, o.str("plain"), o.optBoolean("instrumental"), o.optBoolean("none"))
        }

        /** Musixmatch режет «пиф-пау» на «пиф-» и «пау»: после дефиса пробел не ставим. */
        fun joinWords(w: List<LyricWord>): String = buildString {
            w.forEachIndexed { i, x -> if (i > 0 && !w[i - 1].s.endsWith("-")) append(' '); append(x.s) }
        }
    }
}

data class EqPreset(val id: String, val name: String, val gains: List<Double>, val preamp: Double, val mine: Boolean)
data class Eq(val enabled: Boolean, val preset: String, val gains: List<Double>, val preamp: Double, val freqs: List<Int>, val max: Double, val name: String, val presets: List<EqPreset>) {
    companion object {
        private fun doubles(a: JSONArray?) = if (a == null) emptyList() else (0 until a.length()).map { a.optDouble(it, 0.0) }
        fun of(o: JSONObject) = Eq(
            o.optBoolean("enabled"), o.str("preset"), doubles(o.optJSONArray("gains")), o.optDouble("preamp", 0.0),
            o.optJSONArray("freqs")?.let { a -> (0 until a.length()).map { a.optInt(it) } } ?: emptyList(),
            o.optDouble("max", 12.0), o.str("name"),
            o.optJSONArray("presets").objects().map { EqPreset(it.str("id"), it.str("name"), doubles(it.optJSONArray("gains")), it.optDouble("preamp", 0.0), it.optBoolean("mine")) },
        )
    }
}

// ---------- итоги года ----------

data class WrappedArtist(val name: String, val cover: String, val sec: Int, val share: Int)
data class Wrapped(
    val year: Int, val total: Int, val activeDays: Int, val months: List<Int>, val bestMonthName: String, val bestMonth: Int,
    val bestDayText: String, val bestDaySec: Int, val comparison: String, val tracks: List<Track>, val artists: List<WrappedArtist>,
    val persona: String, val personaText: String,
) {
    companion object {
        fun of(o: JSONObject): Wrapped {
            val p = o.optJSONObject("persona") ?: JSONObject()
            return Wrapped(
                year = o.optInt("year"), total = o.optInt("total"), activeDays = o.optInt("activeDays"),
                months = o.optJSONArray("months")?.let { a -> (0 until a.length()).map { a.optInt(it) } } ?: emptyList(),
                bestMonthName = o.str("bestMonthName"), bestMonth = o.optInt("bestMonth"),
                bestDayText = o.str("bestDayText"), bestDaySec = o.objOrNull("bestDay")?.optInt("sec") ?: 0,
                comparison = o.str("comparison"), tracks = Track.list(o.optJSONArray("tracks")),
                artists = o.optJSONArray("artists").objects().map { WrappedArtist(it.str("name"), it.str("cover"), it.optInt("sec"), it.optInt("share")) },
                persona = p.str("name"), personaText = p.str("text"),
            )
        }
    }
}
