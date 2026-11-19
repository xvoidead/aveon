import SwiftUI
import UIKit

// Раскрытый плеер: пластинка (её можно крутить, как на Android), текст, очередь.
struct PlayerLayer: View {
    @ObservedObject var engine = Engine.shared
    @Binding var mode: PlayerMode
    var onClose: () -> Void

    @Environment(\.colorScheme) private var scheme
    @State private var dragY: CGFloat = 0
    @State private var angle: Double = 0
    @State private var lastTouchAngle: Double = 0
    @State private var scrubbing = false
    @State private var scrubBase: Double = 0
    @State private var spin = false
    @State private var volume: Double = 1

    private var pl: PlayerState { engine.player }

    var body: some View {
        ZStack {
            ArtBackground(cover: pl.track?.cover ?? "")
                .ignoresSafeArea()

            VStack(spacing: 0) {
                header
                Spacer(minLength: 8)
                switch mode {
                case .art: art
                case .lyrics: LyricsView()
                case .queue: QueueView()
                }
                Spacer(minLength: 8)
                controls
                bottomRow
            }
            .padding(.horizontal, 22)
            .padding(.bottom, 18)
            .offset(y: dragY)
            .scaleEffect(1 - min(max(dragY, 0) / 1200, 0.06))
        }
        .overlay(alignment: .top) { ToastsView() }
        .gesture(
            DragGesture(minimumDistance: 8)
                .onChanged { value in
                    if value.translation.height > 0 { dragY = value.translation.height }
                }
                .onEnded { value in
                    if value.translation.height > 110 || value.predictedEndTranslation.height > 160 {
                        onClose()
                    } else {
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) { dragY = 0 }
                    }
                }
        )
    }

    private var header: some View {
        HStack {
            Button(action: onClose) {
                Image(systemName: "chevron.down")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(.white.opacity(0.8))
                    .frame(width: 40, height: 40)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Spacer()
            VStack(spacing: 1) {
                Text(pl.via.isEmpty ? "Сейчас играет" : pl.via)
                    .font(T.caption)
                    .foregroundColor(.white.opacity(0.65))
                    .lineLimit(1)
                if let room = pl.room, room.members.count > 1 {
                    Text("рума \(room.code)")
                        .font(T.caption)
                        .foregroundColor(Pal.apple.voice)
                }
            }
            Spacer()
            Button {
                NotificationCenter.default.post(name: .aveonOpenProfile, object: nil)
            } label: {
                Image(systemName: "person.crop.circle")
                    .font(.system(size: 20, weight: .regular))
                    .foregroundColor(.white.opacity(0.8))
                    .frame(width: 40, height: 40)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.top, 8)
    }

    private var art: some View {
        VStack(spacing: 18) {
            GeometryReader { geo in
                let center = CGPoint(x: geo.size.width / 2, y: geo.size.height / 2)
                ZStack {
                    Circle()
                        .fill(Color.black.opacity(0.55))
                        .frame(width: 300, height: 300)
                    Circle()
                        .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
                        .frame(width: 292, height: 292)
                    RemoteImage(url: pl.track?.cover ?? "", corner: 300)
                        .frame(width: 230, height: 230)
                        .clipShape(Circle())
                        .overlay(Circle().strokeBorder(Color.white.opacity(0.12), lineWidth: 1))
                        .shadow(color: .black.opacity(0.5), radius: 24, y: 12)
                        .rotationEffect(.degrees(angle))
                        .animation(.linear(duration: 6).repeatForever(autoreverses: false), value: spin)
                    if pl.playing && !scrubbing {
                        Circle()
                            .fill(Color.black.opacity(0.9))
                            .frame(width: 34, height: 34)
                            .overlay(Circle().strokeBorder(Color.white.opacity(0.25), lineWidth: 1))
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(Circle())
                .gesture(
                    DragGesture(minimumDistance: 4)
                        .onChanged { value in
                            let a = atan2(value.location.y - center.y, value.location.x - center.x) * 180 / .pi
                            var delta = a - lastTouchAngle
                            if delta > 180 { delta -= 360 }
                            if delta < -180 { delta += 360 }
                            lastTouchAngle = a
                            scrubbing = true
                            angle += delta
                            // полный оборот — 30 секунд
                            let seek = scrubBase + Double(delta) / 360.0 * 30.0
                            scrubBase = seek
                            engine.send("seek", [max(0, seek)])
                        }
                        .onEnded { _ in
                            scrubbing = false
                            scrubBase = pl.posNow()
                        }
                )
            }
            .frame(height: 300)
            .onAppear { spin = pl.playing }
            .onChange(of: pl.playing) { playing in spin = playing }
        }
        .padding(.vertical, 8)
    }

    private var controls: some View {
        VStack(spacing: 14) {
            VStack(spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(pl.track?.title ?? "ничего не играет")
                        .font(T.title2)
                        .foregroundColor(.white)
                        .lineLimit(2)
                    Spacer()
                }
                HStack {
                    Text(pl.track?.artist ?? "")
                        .font(T.subhead)
                        .foregroundColor(.white.opacity(0.65))
                        .lineLimit(1)
                    Spacer()
                    Text("\(AveonKit.time(pl.posNow())) / \(AveonKit.time(pl.dur))")
                        .font(T.caption)
                        .foregroundColor(.white.opacity(0.5))
                        .monospacedDigit()
                }
            }

            Scrubber(value: pl.posNow(), duration: max(pl.dur, 1), accent: Pal.apple.accent) { sec in
                engine.send("seek", [sec])
            }

            HStack(spacing: 0) {
                IconButton(system: "shuffle", size: 17, color: pl.shuffle ? Pal.apple.accent : .white.opacity(0.75)) {
                    engine.send("shuffle")
                }
                Spacer()
                IconButton(system: "backward.fill", size: 26, color: .white) { engine.send("prev") }
                    .frame(width: 56, height: 56)
                Spacer()
                PlayButton(playing: pl.playing, size: 68, icon: 28, color: .black, background: .white) {
                    engine.send("toggle")
                }
                Spacer()
                IconButton(system: "forward.fill", size: 26, color: .white) { engine.send("next") }
                    .frame(width: 56, height: 56)
                Spacer()
                IconButton(system: "repeat", size: 17, color: pl.repeat == "off" ? .white.opacity(0.75) : Pal.apple.accent) {
                    engine.send("repeat")
                }
            }

            HStack(spacing: 12) {
                Image(systemName: pl.muted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                    .font(.system(size: 12))
                    .foregroundColor(.white.opacity(0.6))
                Slider(
                    value: Binding(
                        get: { volume },
                        set: {
                            volume = $0
                            engine.send("volume", [$0, false])
                        }
                    ),
                    onEditingChanged: { editing in
                        if !editing { engine.send("volume", [volume, true]) }
                    },
                    in: 0...1
                )
                .tint(.white)
            }
            .onAppear { volume = pl.volume }
            .onChange(of: pl.volume) { v in
                if !scrubbing { volume = v }
            }
        }
    }

    private var bottomRow: some View {
        HStack(spacing: 10) {
            ForEach(PlayerMode.allCases, id: \.self) { m in
                Button {
                    withAnimation(.easeOut(duration: 0.2)) { mode = m }
                } label: {
                    Text(title(m))
                        .font(T.footnoteM)
                        .foregroundColor(mode == m ? Pal.apple.accent : .white.opacity(0.7))
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(Capsule().fill(mode == m ? Color.white.opacity(0.14) : Color.clear))
                }
                .buttonStyle(.plain)
            }
            Spacer()
            IconButton(system: "slider.horizontal.3", size: 17, color: .white.opacity(0.75)) {
                NotificationCenter.default.post(name: .aveonOpenEq, object: nil)
            }
            IconButton(system: "waveform", size: 17, color: pl.duckOn ? Pal.apple.voice : .white.opacity(0.75)) {
                engine.send("duckEnabled", [!pl.duckOn])
            }
            IconButton(system: "shippingbox.fill", size: 17, color: pl.barrel > 0.5 ? Pal.apple.voice : .white.opacity(0.75)) {
                engine.send("barrel")
            }
        }
        .padding(.top, 10)
    }

    private func title(_ m: PlayerMode) -> String {
        switch m {
        case .art: return "Обложка"
        case .lyrics: return "Текст"
        case .queue: return "Очередь"
        }
    }
}

/// Фон плеера: размытая обложка (палитра трека из движка).
struct ArtBackground: View {
    let cover: String
    @State private var image: UIImage? = nil

    var body: some View {
        ZStack {
            Color.black
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .blur(radius: 60)
                    .scaleEffect(1.4)
                    .opacity(0.75)
            } else {
                LinearGradient(colors: [Color(hex: 0x1B1411), Color.black], startPoint: .top, endPoint: .bottom)
            }
            LinearGradient(colors: [Color.black.opacity(0.35), Color.black.opacity(0.75)], startPoint: .top, endPoint: .bottom)
        }
        .ignoresSafeArea()
        .onAppear {
            ImageCache.shared.image(for: cover) { image = $0 }
        }
        .onChange(of: cover) { _ in
            image = nil
            ImageCache.shared.image(for: cover) { image = $0 }
        }
    }
}

/// Очередь: что играет и что дальше.
struct QueueView: View {
    @ObservedObject var engine = Engine.shared
    @State private var tracks: [Track] = []
    @State private var pos: Int = 0

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 4) {
                ForEach(Array(tracks.enumerated()), id: \.offset) { index, track in
                    TrackRow(track: track, index: index == pos ? nil : index) {
                        engine.send("queuePlay", [index])
                    }
                }
            }
            .padding(.horizontal, 4)
        }
        .task {
            await reload()
        }
    }

    private func reload() async {
        guard let q = await engine.obj("queue") else { return }
        tracks = Track.list(q.arr("tracks"))
        pos = q.int("pos")
    }
}

/// Текст песни: подсветка текущей строки, тап — перемотка.
struct LyricsView: View {
    @ObservedObject var engine = Engine.shared
    @State private var lyrics = LyricsState()
    @State private var none = false
    @State private var instrumental = false
    @State private var plain = ""

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if none {
                        EmptyBox(title: "Текста нет", text: "Для этого трека не нашлось текста")
                    } else if instrumental {
                        EmptyBox(title: "Инструментал", text: "Тут нет слов — только музыка")
                    } else if lyrics.synced {
                        ForEach(lyrics.lines) { line in
                            Text(line.s)
                                .font(T.lyric)
                                .foregroundColor(active(line) ? .white : .white.opacity(0.45))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .id(line.id)
                                .onTapGesture { engine.send("seek", [line.t]) }
                        }
                    } else if !plain.isEmpty {
                        Text(plain)
                            .font(.callout)
                            .foregroundColor(.white.opacity(0.8))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(.vertical, 8)
            }
            .onChange(of: currentLine) { line in
                guard let line else { return }
                withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo(line.id, anchor: .center) }
            }
        }
        .task { await load() }
    }

    private var currentLine: LyricLine? {
        let now = engine.player.posNow()
        var found: LyricLine? = nil
        for line in lyrics.lines where line.t <= now { found = line }
        return found
    }

    private func active(_ line: LyricLine) -> Bool {
        currentLine?.id == line.id
    }

    private func load() async {
        guard let r = await engine.call("lyrics") as? JObj else { return }
        let l = LyricsState(r)
        lyrics = l
        none = l.none
        instrumental = l.instrumental
        plain = l.plain
    }
}
