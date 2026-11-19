import Foundation

// Данные, которые присылает движок (renderer/native.js). JSON разбираем вручную —
// как в Android-порте (Models.kt): часть полей приходит то строкой, то числом.

typealias JObj = [String: Any]

extension Dictionary where Key == String, Value == Any {
    func str(_ k: String) -> String { (self[k] as? String) ?? "" }
    func str(_ k: String, _ d: String) -> String { (self[k] as? String) ?? d }
    func num(_ k: String) -> Double { (self[k] as? NSNumber)?.doubleValue ?? 0 }
    func num(_ k: String, _ d: Double) -> Double { (self[k] as? NSNumber)?.doubleValue ?? d }
    func int(_ k: String) -> Int { (self[k] as? NSNumber)?.intValue ?? 0 }
    func flag(_ k: String) -> Bool { (self[k] as? NSNumber)?.boolValue ?? false }
    func flag(_ k: String, _ d: Bool) -> Bool { (self[k] as? NSNumber)?.boolValue ?? d }
    func obj(_ k: String) -> JObj? { self[k] as? JObj }
    func arr(_ k: String) -> [JObj] { (self[k] as? [JObj]) ?? [] }
    func strs(_ k: String) -> [String] { (self[k] as? [String]) ?? [] }
}

// ---------- трек ----------

struct Track: Identifiable, Hashable {
    var id: String = ""
    var title: String = ""
    var artist: String = ""
    var album: String = ""
    var duration: Double = 0
    var cover: String = ""
    var source: String = ""
    var playable: Bool = true
    var preview: Bool = false
    var dl: Bool = false
    var explicit: Bool = false
    var plays: Int = 0

    init() {}

    init(_ o: JObj) {
        id = o.str("id")
        title = o.str("title")
        artist = o.str("artist")
        album = o.str("album")
        let d = o.num("duration")
        duration = d.isNaN ? 0 : d
        cover = o.str("cover")
        source = o.str("source")
        playable = o.flag("playable", true)
        preview = o.flag("preview")
        dl = o.flag("dl")
        explicit = o.flag("explicit")
        plays = o.int("plays")
    }

    static func list(_ arr: [JObj]) -> [Track] { arr.map { Track($0) } }
}

// ---------- плеер ----------

/// Фокус-сессия плеера. Имя `PlayerFocusState`, а не `FocusState`, чтобы не конфликтовать
/// со SwiftUI-свойством `@FocusState` в видах.
struct PlayerFocusState: Hashable {
    var phase: String = ""
    var left: Int = 0
    var paused: Bool = false
    var round: Int = 1

    init(_ o: JObj) {
        phase = o.str("phase")
        left = o.int("left")
        paused = o.flag("paused")
        round = max(1, o.int("round"))
    }
}

struct RoomState: Hashable {
    var code: String = ""
    var connected: Bool = true
    var members: [String] = []
    var you: String = ""

    init(_ o: JObj) {
        code = o.str("code")
        connected = o.flag("connected")
        members = o.strs("members")
        you = o.str("you")
    }
}

struct PlayerState {
    var track: Track? = nil
    var playing: Bool = false
    var pos: Double = 0
    var dur: Double = 0
    var at: Date = Date()
    var volume: Double = 1
    var muted: Bool = false
    var shuffle: Bool = false
    /// Режим повтора. JSON-ключ остаётся `"repeat"` — переименование нужно только в Swift,
    /// потому что `repeat` совпадает с одноимённым методом `Sequence`.
    var repeatMode: String = "off"
    var via: String = ""
    var barrel: Float = 0
    var manual: Bool = false
    var call: Bool = false
    var duckOn: Bool = false
    var wave: Bool = false
    var waveLoading: Bool = false
    var dj: Bool = false
    var karaoke: Bool = false
    var sleep: Int = 0
    var focus: PlayerFocusState? = nil
    var room: RoomState? = nil
    var friendsBadge: Bool = false
    var locked: Bool = false
    var hasQueue: Bool = false

    init() {}

    init(_ o: JObj) {
        if let t = o.obj("track") { track = Track(t) }
        playing = o.flag("playing")
        pos = o.num("pos")
        dur = o.num("dur")
        at = Date()
        volume = o.num("volume", 1)
        muted = o.flag("muted")
        shuffle = o.flag("shuffle")
        repeatMode = o.str("repeat", "off")
        via = o.str("via")
        barrel = Float(o.num("barrel"))
        manual = o.flag("manual")
        call = o.flag("call")
        duckOn = o.flag("duckOn")
        wave = o.flag("wave")
        waveLoading = o.flag("waveLoading")
        dj = o.flag("dj")
        karaoke = o.flag("karaoke")
        sleep = o.int("sleep")
        if let f = o.obj("focus") { focus = PlayerFocusState(f) }
        if let r = o.obj("room") { room = RoomState(r) }
        friendsBadge = o.flag("friendsBadge")
        locked = o.flag("locked")
        hasQueue = o.flag("hasQueue")
    }

    /// Позиция сейчас: движок присылает её раз в секунду, между присылками досчитываем сами.
    func posNow(_ now: Date = Date()) -> Double {
        guard playing else { return pos }
        let limit = dur > 0 ? dur : Double.greatestFiniteMagnitude
        return min(limit, pos + now.timeIntervalSince(at))
    }
}

// ---------- аккаунт и статистика ----------

struct AccountState {
    var loggedIn: Bool = false
    var name: String = ""
    var login: String = ""
    var avatar: String = ""
    var server: String = ""

    init() {}

    init(_ o: JObj) {
        loggedIn = o.flag("loggedIn")
        name = o.str("name")
        login = o.str("login")
        avatar = o.str("avatar")
        server = o.str("server")
    }
}

struct StatsState {
    var today: Int = 0
    var month: Int = 0
    var artist: String = ""
    var monthName: String = ""

    init() {}

    init(_ o: JObj) {
        today = o.int("today")
        month = o.int("month")
        artist = o.str("artist")
        monthName = o.str("monthName")
    }
}

// ---------- библиотека ----------

struct Chip: Identifiable, Hashable {
    var id: String { label + icon }
    var label: String = ""
    var active: Bool = false
    var icon: String = ""
    var cover: String = ""
    var count: String = ""

    init(_ o: JObj) {
        label = o.str("label")
        active = o.flag("active")
        icon = o.str("icon")
        cover = o.str("cover")
        count = o.str("count")
    }
}

struct ActionItem: Identifiable, Hashable {
    var id: String { s + icon + label }
    var s: String = ""
    var label: String = ""
    var icon: String = ""
    var primary: Bool = false
    var disabled: Bool = false

    init(_ o: JObj) {
        s = o.str("s")
        label = o.str("label")
        icon = o.str("icon")
        primary = o.flag("primary")
        disabled = o.flag("disabled")
    }
}

struct EmptyState {
    var title: String = ""
    var text: String = ""
    var loading: Bool = false
    var actions: [ActionItem] = []

    init(_ o: JObj) {
        title = o.str("title")
        text = o.str("text")
        loading = o.flag("loading")
        actions = o.arr("actions").map { ActionItem($0) }
    }
}

struct Card: Identifiable, Hashable {
    var id: Int = 0
    var img: String = ""
    var title: String = ""
    var sub: String = ""
    var badge: String = ""
    var letter: String = ""
    var round: Bool = false

    init(_ o: JObj) {
        id = o.int("id")
        img = o.str("img")
        title = o.str("title")
        sub = o.str("sub")
        badge = o.str("badge")
        letter = o.str("letter")
        round = o.flag("round")
    }
}

struct HeroButton: Identifiable, Hashable {
    var id: Int = 0
    var s: String = ""
    var icon: String = ""
    var primary: Bool = false
    var disabled: Bool = false

    init(_ o: JObj) {
        id = o.int("id")
        s = o.str("s")
        icon = o.str("icon")
        primary = o.flag("primary")
        disabled = o.flag("disabled")
    }
}

enum LibBlock {
    case rows(from: Int, n: Int)
    case head(s: String, count: String)
    case grid([Card])
    case strip([Card])
    case hero(name: String, stats: String, meta: String, img: String, banner: String, buttons: [HeroButton])
    case group(img: String, title: String, sub: String, play: Int)
    case loading(String)
    case para(String)

    static func of(_ o: JObj) -> LibBlock? {
        switch o.str("t") {
        case "rows": return .rows(from: o.int("from"), n: o.int("n"))
        case "h": return .head(s: o.str("s"), count: o.str("count"))
        case "grid": return .grid(o.arr("items").map { Card($0) })
        case "row": return .strip(o.arr("items").map { Card($0) })
        case "hero":
            return .hero(
                name: o.str("name"), stats: o.str("stats"), meta: o.str("meta"),
                img: o.str("img"), banner: o.str("banner"),
                buttons: o.arr("buttons").map { HeroButton($0) }
            )
        case "group": return .group(img: o.str("img"), title: o.str("title"), sub: o.str("sub"), play: o.int("play"))
        case "loading": return .loading(o.str("s"))
        case "p": return .para(o.str("s"))
        default: return nil
        }
    }
}

struct LibraryState {
    var view: String = ""
    var sub: String = ""
    var title: String = ""
    var sub2: String = ""
    var placeholder: String = ""
    var query: String = ""
    var chips: [Chip] = []
    var actions: [ActionItem] = []
    var empty: EmptyState? = nil
    var blocks: [LibBlock] = []
    var tracks: [Track] = []
    var reorder: Bool = false

    init() {}

    init(_ root: JObj) {
        let o = root.obj("snap") ?? [:]
        view = o.str("view")
        sub = o.str("sub")
        title = o.str("title")
        sub2 = o.str("sub2")
        placeholder = o.str("placeholder")
        query = o.str("query")
        chips = o.arr("chips").map { Chip($0) }
        actions = o.arr("actions").map { ActionItem($0) }
        if let e = o.obj("empty") { empty = EmptyState(e) }
        blocks = o.arr("blocks").compactMap { LibBlock.of($0) }
        tracks = Track.list(root.arr("tracks"))
        reorder = o.flag("reorder")
    }
}

// ---------- меню, диалоги, панели ----------

struct MenuItem: Identifiable, Hashable {
    var id: String { label + count + icon }
    var label: String = ""
    var icon: String = ""
    var count: String = ""
    var danger: Bool = false
    var muted: Bool = false
    var sep: Bool = false
    var note: String = ""

    init(_ o: JObj) {
        label = o.str("label")
        icon = o.str("icon")
        count = o.str("count")
        danger = o.flag("danger")
        muted = o.flag("muted")
        sep = o.flag("sep")
        note = o.str("note")
    }
}

struct MenuState: Identifiable {
    var id: Int = 0
    var items: [MenuItem] = []

    init(_ o: JObj) {
        id = o.int("id")
        items = o.arr("items").map { MenuItem($0) }
    }
}

struct AskState: Identifiable {
    var id: Int = 0
    var title: String = ""
    var text: String = ""
    var value: String = ""
    var ok: String = "Готово"
    var input: Bool = true
    var danger: Bool = false
    var password: Bool = false

    init(_ o: JObj) {
        id = o.int("id")
        title = o.str("title")
        text = o.str("text")
        value = o.str("value")
        ok = o.str("ok", "Готово")
        input = o.flag("input")
        danger = o.flag("danger")
        password = o.flag("password")
    }
}

struct ToastState: Identifiable, Hashable {
    var id: Int = 0
    var msg: String = ""
    var err: Bool = false
}

/// Узел «зеркала» панели: тип (h, p, text, img, btn, switch, range, input, select, seg, field, nav, list, box, form).
struct MNode: Identifiable {
    var t: String = ""
    var o: JObj = [:]
    var kids: [MNode] = []

    var id: Int { o.int("id") }
    var s: String { o.str("s") }
    var cls: String { o.str("cls") }

    func has(_ c: String) -> Bool { cls.split(separator: " ").map(String.init).contains(c) }

    init(_ o: JObj) {
        t = o.str("t")
        self.o = o
        kids = o.arr("kids").map { MNode($0) }
    }
}

struct PanelState: Identifiable {
    var key: String = ""
    var title: String = ""
    var closable: Bool = true
    var kids: [MNode] = []

    var id: String { key }

    init(_ o: JObj) {
        key = o.str("key")
        title = o.str("title")
        closable = o.flag("closable")
        kids = o.arr("kids").map { MNode($0) }
    }
}

// ---------- главная, волна, текст, эквалайзер, итоги ----------

struct HomeList: Identifiable, Hashable {
    var id: String { title + meta }
    var title: String = ""
    var meta: String = ""
    var cover: String = ""
    var icon: String = ""

    init(_ o: JObj) {
        title = o.str("title")
        meta = o.str("meta")
        cover = o.str("cover")
        icon = o.str("icon")
    }
}

struct HomeArtist: Identifiable, Hashable {
    var id: String { name }
    var name: String = ""
    var cover: String = ""

    init(_ o: JObj) {
        name = o.str("name")
        cover = o.str("cover")
    }
}

struct HomeFriend: Identifiable, Hashable {
    var id: Int = 0
    var name: String = ""
    var title: String = ""
    var artist: String = ""
    var cover: String = ""

    init(_ o: JObj) {
        id = o.int("id")
        name = o.str("name")
        title = o.str("title")
        artist = o.str("artist")
        cover = o.str("cover")
    }
}

struct HomeState {
    var greeting: String = ""
    var line: String = ""
    var waveYm: Bool = false
    var waveNote: String = ""
    var tracks: [Track] = []
    var lists: [HomeList] = []
    var artists: [HomeArtist] = []
    var friends: [HomeFriend] = []
    var wrapped: Int = 0

    init() {}

    init(_ o: JObj) {
        let w = o.obj("wave") ?? [:]
        greeting = o.str("greeting")
        line = o.str("line")
        waveYm = w.flag("ym")
        waveNote = w.str("note")
        tracks = Track.list(o.arr("tracks"))
        lists = o.arr("lists").map { HomeList($0) }
        artists = o.arr("artists").map { HomeArtist($0) }
        friends = o.arr("friends").map { HomeFriend($0) }
        wrapped = o.int("wrapped")
    }
}

struct WaveOpt: Identifiable, Hashable {
    var id: String { v }
    var v: String = ""
    var s: String = ""

    init(_ o: JObj) {
        v = o.str("v")
        s = o.str("s")
    }
}

struct WaveWord: Identifiable, Hashable {
    var id: String { key }
    var key: String = ""
    var title: String = ""
    var cur: String = ""
    var opts: [WaveOpt] = []

    init(_ o: JObj) {
        key = o.str("key")
        title = o.str("title")
        cur = o.str("cur")
        opts = o.arr("opts").map { WaveOpt($0) }
    }
}

struct WaveState {
    var ym: Bool = false
    var active: Bool = false
    var loading: Bool = false
    var playing: Bool = false
    var dj: Bool = false
    var words: [WaveWord] = []
    var upcoming: [Track] = []

    init() {}

    init(_ o: JObj) {
        ym = o.flag("ym")
        active = o.flag("active")
        loading = o.flag("loading")
        playing = o.flag("playing")
        dj = o.flag("dj")
        words = o.arr("words").map { WaveWord($0) }
        upcoming = Track.list(o.arr("upcoming"))
    }
}

struct LyricWord: Hashable {
    var t: Double = 0
    var s: String = ""

    init(_ o: JObj) {
        t = o.num("t")
        s = o.str("s")
    }
}

struct LyricLine: Identifiable, Hashable {
    var id: String { String(t) + s }
    var t: Double = 0
    var s: String = ""
    var words: [LyricWord]? = nil

    init(_ o: JObj) {
        t = o.num("t")
        s = o.str("s")
        let w = o.arr("words")
        if !w.isEmpty { words = w.map { LyricWord($0) } }
    }
}

struct LyricsState {
    var id: String = ""
    var from: String = ""
    var lines: [LyricLine] = []
    var plain: String = ""
    var instrumental: Bool = false
    var none: Bool = false
    var error: String = ""

    var synced: Bool { !lines.isEmpty }

    init() {}

    init(_ o: JObj) {
        id = o.str("id")
        from = o.str("from")
        if o.arr("words").isEmpty == false {
            lines = o.arr("words").map { l in
                let words = l.arr("w").map { LyricWord($0) }
                var line = LyricLine([:])
                line.t = l.num("t")
                line.s = LyricsState.joinWords(words)
                line.words = words
                return line
            }
        } else {
            lines = o.arr("lines").map { LyricLine($0) }
        }
        plain = o.str("plain")
        instrumental = o.flag("instrumental")
        none = o.flag("none")
    }

    /// Musixmatch режет «пиф-пау» на «пиф-» и «пау»: после дефиса пробел не ставим.
    static func joinWords(_ w: [LyricWord]) -> String {
        var out = ""
        for (i, x) in w.enumerated() {
            if i > 0 && !w[i - 1].s.hasSuffix("-") { out += " " }
            out += x.s
        }
        return out
    }
}

struct EqPreset: Identifiable, Hashable {
    var id: String
    var name: String = ""
    var gains: [Double] = []
    var preamp: Double = 0
    var mine: Bool = false

    init(_ o: JObj) {
        id = o.str("id")
        name = o.str("name")
        gains = (o["gains"] as? [NSNumber])?.map { $0.doubleValue } ?? []
        preamp = o.num("preamp")
        mine = o.flag("mine")
    }
}

struct EqState {
    var enabled: Bool = false
    var preset: String = ""
    var gains: [Double] = []
    var preamp: Double = 0
    var freqs: [Int] = []
    var max: Double = 12
    var name: String = ""
    var presets: [EqPreset] = []

    init() {}

    init(_ o: JObj) {
        enabled = o.flag("enabled")
        preset = o.str("preset")
        gains = (o["gains"] as? [NSNumber])?.map { $0.doubleValue } ?? []
        preamp = o.num("preamp")
        freqs = (o["freqs"] as? [NSNumber])?.map { $0.intValue } ?? []
        max = o.num("max", 12)
        name = o.str("name")
        presets = o.arr("presets").map { EqPreset($0) }
    }
}

struct WrappedArtist: Identifiable, Hashable {
    var id: String { name }
    var name: String = ""
    var cover: String = ""
    var sec: Int = 0
    var share: Int = 0

    init(_ o: JObj) {
        name = o.str("name")
        cover = o.str("cover")
        sec = o.int("sec")
        share = o.int("share")
    }
}

struct WrappedState {
    var year: Int = 0
    var total: Int = 0
    var activeDays: Int = 0
    var months: [Int] = []
    var bestMonthName: String = ""
    var bestMonth: Int = 0
    var bestDayText: String = ""
    var bestDaySec: Int = 0
    var comparison: String = ""
    var tracks: [Track] = []
    var artists: [WrappedArtist] = []
    var persona: String = ""
    var personaText: String = ""

    init() {}

    init(_ o: JObj) {
        let p = o.obj("persona") ?? [:]
        year = o.int("year")
        total = o.int("total")
        activeDays = o.int("activeDays")
        months = (o["months"] as? [NSNumber])?.map { $0.intValue } ?? []
        bestMonthName = o.str("bestMonthName")
        bestMonth = o.int("bestMonth")
        bestDayText = o.str("bestDayText")
        bestDaySec = o.obj("bestDay")?.int("sec") ?? 0
        comparison = o.str("comparison")
        tracks = Track.list(o.arr("tracks"))
        artists = o.arr("artists").map { WrappedArtist($0) }
        persona = p.str("name")
        personaText = p.str("text")
    }
}

// ---------- профиль, друзья, вход ----------

struct ProfileState {
    var name: String = ""
    var login: String = ""
    var avatar: String = ""
    var host: String = ""
    var sync: String = ""
    var error: String = ""
    var syncing: Bool = false
    var admin: Bool = false
    var friends: Int = 0
    var conns: [Conn] = []
    var devices: [Device]? = nil
    var devicesError: String = ""
    var month: Month = Month()

    struct Conn: Identifiable, Hashable {
        var id: String
        var name: String = ""
        var detail: String = ""
        var on: Bool = false
        var brand: String = ""

        init(_ o: JObj) {
            id = o.str("id")
            name = o.str("name")
            detail = o.str("detail")
            on = o.flag("on")
            brand = o.str("brand")
        }
    }

    struct Device: Identifiable, Hashable {
        var id: String { name + ago }
        var name: String = ""
        var current: Bool = false
        var ago: String = ""

        init(_ o: JObj) {
            name = o.str("name")
            current = o.flag("current")
            ago = o.str("ago")
        }
    }

    struct Artist: Identifiable, Hashable {
        var id: String { name }
        var name: String = ""
        var sec: Int = 0
        var text: String = ""
        var cover: String = ""

        init(_ o: JObj) {
            name = o.str("name")
            sec = o.int("sec")
            text = o.str("text")
            cover = o.str("cover")
        }
    }

    struct Month {
        var key: String = ""
        var label: String = ""
        var current: Bool = false
        var canPrev: Bool = false
        var canNext: Bool = false
        var total: Int = 0
        var totalText: String = ""
        var avgText: String = ""
        var plays: Int = 0
        var activeDays: Int = 0
        var allTimeText: String = ""
        var days: [Int] = []
        var today: Int = 0
        var tracks: [Track] = []
        var artists: [Artist] = []

        init() {}

        init(_ o: JObj) {
            key = o.str("key")
            label = o.str("label")
            current = o.flag("current")
            canPrev = o.flag("canPrev")
            canNext = o.flag("canNext")
            total = o.int("total")
            totalText = o.str("totalText")
            avgText = o.str("avgText")
            plays = o.int("plays")
            activeDays = o.int("activeDays")
            allTimeText = o.str("allTimeText")
            days = (o["days"] as? [NSNumber])?.map { $0.intValue } ?? []
            today = o.int("today")
            tracks = Track.list(o.arr("tracks"))
            artists = o.arr("artists").map { Artist($0) }
        }
    }

    init() {}

    init(_ o: JObj) {
        name = o.str("name")
        login = o.str("login")
        avatar = o.str("avatar")
        host = o.str("host")
        sync = o.str("sync")
        error = o.str("error")
        syncing = o.flag("syncing")
        admin = o.flag("admin")
        friends = o.int("friends")
        conns = o.arr("conns").map { Conn($0) }
        let dv = o.arr("devices")
        devices = dv.isEmpty ? nil : dv.map { Device($0) }
        devicesError = o.str("devicesError")
        if let m = o.obj("month") { month = Month(m) }
    }
}

struct FriendNow: Hashable {
    var track: Track? = nil
    var playing: Bool = false
    var live: Bool = false
    var ago: String = ""
    var pos: Double = 0

    init(_ o: JObj) {
        if let t = o.obj("track") { track = Track(t) }
        playing = o.flag("playing")
        live = o.flag("live")
        ago = o.str("ago")
        pos = o.num("pos")
    }
}

struct FriendOut: Identifiable, Hashable {
    var id: Int = 0
    var name: String = ""
    var login: String = ""
    var avatar: String = ""
    var inRoom: Bool = false
    var unread: Int = 0
    var since: String = ""
    var now: FriendNow? = nil

    init(_ o: JObj) {
        id = o.int("id")
        name = o.str("name")
        login = o.str("login")
        avatar = o.str("avatar")
        inRoom = o.flag("inRoom")
        unread = o.int("unread")
        since = o.str("since")
        if let n = o.obj("now") { now = FriendNow(n) }
    }
}

struct MessageReaction: Identifiable, Hashable {
    var id: String { e }
    var e: String = ""
    var n: Int = 0
    var mine: Bool = false

    init(_ o: JObj) {
        e = o.str("e")
        n = o.int("n")
        mine = o.flag("mine")
    }
}

struct MessageOut: Identifiable, Hashable {
    var id: String = ""
    var mine: Bool = false
    var text: String = ""
    var edited: Bool = false
    var pending: Bool = false
    var my: String = ""
    var time: String = ""
    var track: [String: String]? = nil
    var reactions: [MessageReaction] = []

    init(_ o: JObj) {
        id = o.str("id")
        mine = o.flag("mine")
        text = o.str("text")
        edited = o.flag("edited")
        pending = o.flag("pending")
        my = o.str("my")
        time = o.str("time")
        if let t = o.obj("track") {
            track = ["title": t.str("title"), "artist": t.str("artist"), "cover": t.str("cover")]
        }
        reactions = o.arr("reactions").map { MessageReaction($0) }
    }
}

struct FriendsViewState {
    var mode: String = "list"
    var friend: FriendOut? = nil
    var messages: [MessageOut] = []
    var loading: Bool = false
    var error: String = ""
    var more: Bool = false
    var sending: Bool = false
    var nowTitle: String = ""
    var roomAct: String = ""
    var knocked: Bool = false
    var roomLabel: String = ""
    var stats: ProfileState? = nil

    init() {}

    init(_ o: JObj) {
        mode = o.str("mode", "list")
        if let f = o.obj("friend") { friend = FriendOut(f) }
        messages = o.arr("messages").map { MessageOut($0) }
        loading = o.flag("loading")
        error = o.str("error")
        more = o.flag("more")
        sending = o.flag("sending")
        nowTitle = o.str("nowTitle")
        roomAct = o.str("roomAct")
        knocked = o.flag("knocked")
        roomLabel = o.str("roomLabel")
    }
}

struct AuthState {
    var mode: String = "login"
    var register: Bool = false
    var title: String = ""
    var sub: String = ""
    var go: String = ""
    var busy: Bool = false
    var ask: String = ""
    var other: String = ""
    var login: String = ""
    var error: String = ""
    var forgot: Bool = false
    var code: Bool = false
    var newpass: Bool = false
    var showLogin: Bool = true
    var showPass: Bool = true
    var showPass2: Bool = false
    var showGo: Bool = true
    var showForgot: Bool = true
    var codeState: String = ""
    var codeValue: String = ""

    init() {}

    init(_ o: JObj) {
        mode = o.str("mode")
        register = o.flag("register")
        title = o.str("title")
        sub = o.str("sub")
        go = o.str("go")
        busy = o.flag("busy")
        ask = o.str("ask")
        other = o.str("other")
        login = o.str("login")
        error = o.str("error")
        forgot = o.flag("forgot")
        code = o.flag("code")
        newpass = o.flag("newpass")
        showLogin = o.flag("showLogin")
        showPass = o.flag("showPass")
        showPass2 = o.flag("showPass2")
        showGo = o.flag("showGo")
        showForgot = o.flag("showForgot")
        codeState = o.str("codeState")
        codeValue = o.str("codeValue")
    }
}
