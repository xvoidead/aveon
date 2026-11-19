import SwiftUI

// Главная: приветствие, волна, недавно слушанное, подборки, артисты, друзья.
struct HomeView: View {
    @ObservedObject var engine = Engine.shared
    @ObservedObject var nav = Nav.shared
    @State private var home = HomeState()
    @State private var loaded = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header
                waveCard
                if !home.tracks.isEmpty {
                    SectionHeader(title: "Недавно слушал", action: "Вся медиатека") {
                        nav.go(.library)
                    }
                    tracksRow
                }
                if !home.lists.isEmpty {
                    SectionHeader(title: "Подборки")
                    listsGrid
                }
                if !home.artists.isEmpty {
                    SectionHeader(title: "Артисты")
                    artistsRow
                }
                if !home.friends.isEmpty {
                    SectionHeader(title: "Сейчас слушают", action: "Друзья") {
                        NotificationCenter.default.post(name: .aveonOpenFriends, object: nil)
                    }
                    friendsRow
                }
                if home.wrapped > 0 {
                    wrappedCard
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 8)
            .padding(.bottom, 190)
        }
        .refreshable { await load(force: true) }
        .task { await load() }
        .onChange(of: engine.homeVersion) { _ in Task { await load(force: true) } }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(home.greeting.isEmpty ? "авеон" : home.greeting)
                .font(T.large)
                .foregroundColor(.white)
            if !home.line.isEmpty {
                Text(home.line)
                    .font(T.subhead)
                    .foregroundColor(.white.opacity(0.6))
            }
        }
        .padding(.top, 6)
    }

    private var waveCard: some View {
        Button {
            nav.go(.wave)
        } label: {
            HStack(spacing: 14) {
                ZStack {
                    Circle().fill(Pal.apple.accent.opacity(0.22)).frame(width: 52, height: 52)
                    Image(systemName: "dot.radiowaves.left.and.right")
                        .font(.system(size: 22, weight: .medium))
                        .foregroundColor(Pal.apple.accent)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text("Волна")
                        .font(T.headline)
                        .foregroundColor(.white)
                    Text(home.waveNote.isEmpty ? "Бесконечный поток под твой вкус" : home.waveNote)
                        .font(T.footnote)
                        .foregroundColor(.white.opacity(0.6))
                        .lineLimit(2)
                    if home.waveYm {
                        Text("из твоей Яндекс Музыки")
                            .font(T.caption)
                            .foregroundColor(Pal.apple.voice)
                    }
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.white.opacity(0.4))
            }
            .padding(14)
            .glass(corner: 20)
        }
        .buttonStyle(.plain)
    }

    private var tracksRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 14) {
                ForEach(Array(home.tracks.enumerated()), id: \.offset) { index, track in
                    TileCard(url: track.cover, title: track.title, sub: track.artist) {
                        engine.send("homeTrack", [index])
                    }
                }
            }
            .padding(.vertical, 2)
        }
    }

    private var listsGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14)], spacing: 16) {
            ForEach(Array(home.lists.enumerated()), id: \.offset) { index, list in
                TileCard(url: list.cover, title: list.title, sub: list.meta) {
                    engine.send("homeList", [index])
                    nav.go(.library)
                }
            }
        }
    }

    private var artistsRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 14) {
                ForEach(home.artists) { artist in
                    TileCard(url: artist.cover, title: artist.name, round: true) {
                        engine.send("artist", [artist.name])
                    }
                }
            }
            .padding(.vertical, 2)
        }
    }

    private var friendsRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 14) {
                ForEach(home.friends) { friend in
                    VStack(spacing: 6) {
                        RemoteImage(url: friend.cover, corner: 10)
                            .frame(width: 120, height: 120)
                        Text(friend.name)
                            .font(T.footnoteM)
                            .foregroundColor(.white)
                            .lineLimit(1)
                        Text(friend.title)
                            .font(T.caption)
                            .foregroundColor(.white.opacity(0.55))
                            .lineLimit(1)
                    }
                    .frame(width: 120)
                }
            }
        }
    }

    private var wrappedCard: some View {
        Button {
            engine.send("wrapped")
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "sparkles")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundColor(Pal.apple.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Итоги года")
                        .font(T.headline)
                        .foregroundColor(.white)
                    Text("Посмотри, что ты слушал в \(home.wrapped) году")
                        .font(T.footnote)
                        .foregroundColor(.white.opacity(0.6))
                }
                Spacer()
            }
            .padding(14)
            .glass(corner: 20)
        }
        .buttonStyle(.plain)
    }

    private func load(force: Bool = false) async {
        if loaded && !force { return }
        guard let o = await engine.obj("home") else { return }
        home = HomeState(o)
        loaded = true
    }
}
