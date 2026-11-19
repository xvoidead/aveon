import SwiftUI
import Foundation

// Визуализатор: живой спектр из движка.
struct VisualizerView: View {
    @ObservedObject var engine = Engine.shared
    var onClose: () -> Void

    var body: some View {
        ZStack {
            ArtBackground(cover: engine.player.track?.cover ?? "").ignoresSafeArea()
            VStack(spacing: 24) {
                HStack {
                    Button(action: onClose) {
                        Image(systemName: "xmark")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundColor(.white.opacity(0.8))
                            .frame(width: 40, height: 40)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    Spacer()
                    Text("Визуализатор")
                        .font(T.headline)
                        .foregroundColor(.white)
                    Spacer()
                    Color.clear.frame(width: 40, height: 40)
                }
                Spacer()
                spectrum
                Spacer()
                if let track = engine.player.track {
                    VStack(spacing: 4) {
                        Text(track.title).font(T.title3).foregroundColor(.white).lineLimit(1)
                        Text(track.artist).font(T.subhead).foregroundColor(.white.opacity(0.6)).lineLimit(1)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 30)
        }
        .onAppear { engine.send("spectrum", [true]) }
        .onDisappear { engine.send("spectrum", [false]) }
    }

    private var spectrum: some View {
        GeometryReader { geo in
            let bands = engine.spectrum
            let count = max(bands.count, 1)
            let w = geo.size.width / CGFloat(count)
            HStack(alignment: .bottom, spacing: max(w * 0.18, 1)) {
                ForEach(0..<count, id: \.self) { i in
                    let v = i < bands.count ? CGFloat(bands[i]) : 0
                    RoundedRectangle(cornerRadius: w * 0.3)
                        .fill(
                            LinearGradient(
                                colors: [Pal.apple.accent, Pal.apple.voice],
                                startPoint: .bottom,
                                endPoint: .top
                            )
                        )
                        .frame(width: w, height: max(4, v * geo.size.height))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        }
    }
}

// Итоги года: сколько слушал, любимые треки и артисты.
struct WrappedView: View {
    @ObservedObject var engine = Engine.shared
    let wrapped: WrappedState
    var onClose: () -> Void

    var body: some View {
        ZStack {
            ArtBackground(cover: wrapped.artists.first?.cover ?? "").ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    HStack {
                        Button(action: onClose) {
                            Image(systemName: "xmark")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundColor(.white.opacity(0.8))
                                .frame(width: 40, height: 40)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        Spacer()
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(wrapped.year)")
                            .font(T.large)
                            .foregroundColor(.white)
                        Text(wrapped.persona.isEmpty ? "Итоги года" : wrapped.persona)
                            .font(T.title2)
                            .foregroundColor(.white)
                        if !wrapped.personaText.isEmpty {
                            Text(wrapped.personaText)
                                .font(T.subhead)
                                .foregroundColor(.white.opacity(0.7))
                        }
                    }
                    HStack(spacing: 10) {
                        box(value: AveonKit.duration(Double(wrapped.total)), title: "слушали")
                        box(value: "\(wrapped.activeDays)", title: "дней")
                        box(value: "\(wrapped.tracks.count)", title: "треков")
                    }
                    if !wrapped.comparison.isEmpty {
                        Text(wrapped.comparison)
                            .font(T.subhead)
                            .foregroundColor(.white.opacity(0.7))
                    }
                    if !wrapped.artists.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            SectionHeader(title: "Артисты")
                            ForEach(wrapped.artists) { artist in
                                HStack(spacing: 10) {
                                    RemoteImage(url: artist.cover, corner: 6)
                                        .frame(width: 44, height: 44)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(artist.name).font(T.subheadM).foregroundColor(.white).lineLimit(1)
                                        Text(AveonKit.duration(Double(artist.sec)))
                                            .font(T.caption)
                                            .foregroundColor(.white.opacity(0.55))
                                    }
                                    Spacer()
                                    Text("\(artist.share)%")
                                        .font(T.footnote)
                                        .foregroundColor(.white.opacity(0.5))
                                        .monospacedDigit()
                                }
                            }
                        }
                    }
                    if !wrapped.tracks.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            SectionHeader(title: "Топ-треки")
                            ForEach(Array(wrapped.tracks.enumerated()), id: \.offset) { index, track in
                                TrackRow(track: track, index: index) {
                                    engine.send("wrappedPlay", [wrapped.tracks.map { $0.id }])
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 40)
            }
        }
    }

    private func box(value: String, title: String) -> some View {
        VStack(spacing: 3) {
            Text(value)
                .font(T.title3)
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(title)
                .font(T.caption)
                .foregroundColor(.white.opacity(0.55))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .glass(corner: 16)
    }
}

// Меню движка — как контекстное меню iOS.
struct MenuSheet: View {
    @ObservedObject var engine = Engine.shared

    var body: some View {
        ZStack {
            Color.black.opacity(0.5)
                .ignoresSafeArea()
                .onTapGesture { cancel() }
            VStack {
                Spacer()
                VStack(spacing: 0) {
                    ScrollView {
                        VStack(spacing: 0) {
                            ForEach(Array((engine.menu?.items ?? []).enumerated()), id: \.offset) { index, item in
                                if item.sep {
                                    Divider().overlay(Color.white.opacity(0.1))
                                } else if !item.note.isEmpty {
                                    Text(item.note)
                                        .font(T.caption)
                                        .foregroundColor(.white.opacity(0.55))
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 6)
                                } else {
                                    Button {
                                        pick(index)
                                    } label: {
                                        HStack {
                                            Text(item.label)
                                                .font(T.body)
                                                .foregroundColor(item.danger ? Pal.apple.danger : (item.muted ? .white.opacity(0.6) : .white))
                                                .multilineTextAlignment(.leading)
                                            Spacer()
                                            if !item.count.isEmpty {
                                                Text(item.count)
                                                    .font(T.footnote)
                                                    .foregroundColor(.white.opacity(0.5))
                                            }
                                            if !item.icon.isEmpty {
                                                Image(systemName: item.icon)
                                                    .font(.system(size: 15))
                                                    .foregroundColor(item.danger ? Pal.apple.danger : .white.opacity(0.7))
                                                    .padding(.leading, 10)
                                            }
                                        }
                                        .padding(.horizontal, 16).padding(.vertical, 13)
                                        .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                    .frame(maxHeight: 420)
                    Divider().overlay(Color.white.opacity(0.1))
                    Button(action: cancel) {
                        Text("Отмена")
                            .font(T.headline)
                            .foregroundColor(Pal.apple.accent)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 15)
                    }
                    .buttonStyle(.plain)
                }
                .glass(corner: 20, tint: Color(hex: 0x252527))
                .padding(.horizontal, 10)
                .padding(.bottom, 8)
            }
        }
        .transition(.move(edge: .bottom))
    }

    private func pick(_ index: Int) {
        guard let menu = engine.menu else { return }
        engine.send("menuPick", [menu.id, index])
    }

    private func cancel() {
        guard let menu = engine.menu else { return }
        engine.send("menuCancel", [menu.id])
    }
}

// Диалог движка — как алерт iOS.
struct AskDialog: View {
    @ObservedObject var engine = Engine.shared
    @State private var value = ""

    var body: some View {
        ZStack {
            Color.black.opacity(0.45)
                .ignoresSafeArea()
                .onTapGesture { cancel() }
            VStack(spacing: 0) {
                VStack(spacing: 8) {
                    Text(ask.title)
                        .font(T.headline)
                        .foregroundColor(.white)
                        .multilineTextAlignment(.center)
                    if !ask.text.isEmpty {
                        Text(ask.text)
                            .font(T.footnote)
                            .foregroundColor(.white.opacity(0.75))
                            .multilineTextAlignment(.center)
                    }
                    if ask.input {
                        TextField("", text: $value)
                            .font(T.body)
                            .foregroundColor(.white)
                            .textFieldStyle(.plain)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 12).padding(.vertical, 10)
                            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white.opacity(0.1)))
                            .onSubmit { done() }
                    }
                }
                .padding(18)
                HStack(spacing: 0) {
                    Button(action: cancel) {
                        Text("Отмена")
                            .font(T.body)
                            .foregroundColor(Pal.apple.accent)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 13)
                    }
                    .buttonStyle(.plain)
                    Divider().frame(height: 40).overlay(Color.white.opacity(0.12))
                    Button(action: done) {
                        Text(ask.ok)
                            .font(T.headline)
                            .foregroundColor(ask.danger ? Pal.apple.danger : Pal.apple.accent)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 13)
                    }
                    .buttonStyle(.plain)
                }
            }
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color(hex: 0x2A2A2C)))
            .padding(.horizontal, 40)
        }
        .transition(.opacity)
        .onAppear { value = ask.value }
    }

    private var ask: AskState {
        engine.ask ?? AskState([:])
    }

    private func done() {
        guard let a = engine.ask else { return }
        if a.input && value.trimmingCharacters(in: .whitespaces).isEmpty { return }
        engine.send("askDone", [a.id, a.input ? value : true])
    }

    private func cancel() {
        guard let a = engine.ask else { return }
        engine.send("askDone", [a.id, NSNull()])
    }
}
