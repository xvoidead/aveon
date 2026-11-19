import SwiftUI

// Волна: бесконечный поток под твой вкус. Настройки потока (настроение, характер, язык, диджей).
struct WaveView: View {
    @ObservedObject var engine = Engine.shared
    @State private var wave = WaveState()
    @State private var loaded = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                controls
                if !wave.words.isEmpty {
                    VStack(spacing: 14) {
                        ForEach(wave.words) { word in
                            WavePicker(word: word) { value in
                                engine.send("waveSet", [word.key, value])
                                Task { await load(force: true) }
                            }
                        }
                    }
                }
                if wave.loading {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Собираем волну…").font(T.subhead).foregroundColor(.white.opacity(0.6))
                    }
                }
                if !wave.upcoming.isEmpty {
                    SectionHeader(title: "Дальше")
                    VStack(spacing: 2) {
                        ForEach(Array(wave.upcoming.enumerated()), id: \.offset) { index, track in
                            TrackRow(track: track) {
                                engine.send("waveUpcoming", [index])
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 10)
            .padding(.bottom, 190)
        }
        .task { await load() }
        .onChange(of: engine.player.wave) { _ in Task { await load(force: true) } }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Волна")
                .font(T.large)
                .foregroundColor(.white)
            Text(wave.ym ? "Настоящая «моя волна» из твоей Яндекс Музыки" : "Своя волна из того, что ты слушаешь")
                .font(T.subhead)
                .foregroundColor(.white.opacity(0.6))
        }
    }

    private var controls: some View {
        VStack(spacing: 14) {
            HStack(spacing: 14) {
                PlayButton(playing: wave.playing, size: 60, icon: 24, color: .black, background: .white) {
                    engine.send("waveGo")
                    Task { await load(force: true) }
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(wave.active ? (wave.playing ? "Волна играет" : "Волна на паузе") : "Включить волну")
                        .font(T.headline)
                        .foregroundColor(.white)
                    if wave.dj {
                        Text("Диджей объявляет треки")
                            .font(T.footnote)
                            .foregroundColor(Pal.apple.voice)
                    }
                }
                Spacer()
                if wave.active {
                    IconButton(system: "hand.thumbsup", size: 17, color: .white.opacity(0.8)) {
                        engine.send("waveLike")
                        Task { await load(force: true) }
                    }
                    IconButton(system: "hand.thumbsdown", size: 17, color: .white.opacity(0.8)) {
                        engine.send("waveDislike")
                        Task { await load(force: true) }
                    }
                }
            }
            .padding(16)
            .glass(corner: 22)
        }
    }

    private func load(force: Bool = false) async {
        if loaded && !force { return }
        guard let o = await engine.obj("wave") else { return }
        wave = WaveState(o)
        loaded = true
    }
}

/// Выбор одного параметра волны (настроение, характер, язык) — как сегмент в iOS.
struct WavePicker: View {
    let word: WaveWord
    var onPick: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(word.title)
                .font(T.footnoteM)
                .foregroundColor(.white.opacity(0.6))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(word.opts) { opt in
                        Button {
                            onPick(opt.v)
                        } label: {
                            Text(opt.s)
                                .font(T.subheadM)
                                .foregroundColor(word.cur == opt.v ? .black : .white)
                                .padding(.horizontal, 14).padding(.vertical, 8)
                                .background(Capsule().fill(word.cur == opt.v ? Color.white : Color.white.opacity(0.12)))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}
