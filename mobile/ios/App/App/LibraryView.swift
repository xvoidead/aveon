import SwiftUI

// Медиатека: разделы движка (свои файлы, альбомы, артисты, загрузки…) и их содержимое.
// Движок отдаёт «снимок» раздела: заголовок, чипы, кнопки, блоки списка и сами треки.
struct LibraryView: View {
    @ObservedObject var engine = Engine.shared
    @State private var query = ""

    private var lib: LibraryState { engine.library }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                title
                if !lib.chips.isEmpty { chips }
                if !lib.actions.isEmpty { actions }
                if let empty = lib.empty {
                    EmptyBox(title: empty.title, text: empty.text, loading: empty.loading)
                    if !empty.actions.isEmpty {
                        HStack(spacing: 10) {
                            ForEach(Array(empty.actions.enumerated()), id: \.offset) { index, action in
                                Button {
                                    engine.send("emptyAction", [index])
                                } label: {
                                    Text(action.s)
                                        .font(T.subheadM)
                                        .foregroundColor(action.primary ? .black : .white)
                                        .padding(.horizontal, 16).padding(.vertical, 9)
                                        .background(Capsule().fill(action.primary ? Color.white : Color.white.opacity(0.12)))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                blocks
            }
            .padding(.horizontal, 18)
            .padding(.top, 8)
            .padding(.bottom, 190)
        }
        .refreshable {
            engine.send("library")
        }
    }

    private var title: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 3) {
                Text(lib.title.isEmpty ? "Медиатека" : lib.title)
                    .font(T.large)
                    .foregroundColor(.white)
                if !lib.sub2.isEmpty {
                    Text(lib.sub2)
                        .font(T.subhead)
                        .foregroundColor(.white.opacity(0.6))
                }
            }
            Spacer()
        }
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(lib.chips.enumerated()), id: \.offset) { index, chip in
                    Button {
                        engine.send("chip", [index])
                    } label: {
                        HStack(spacing: 6) {
                            if !chip.icon.isEmpty {
                                Image(systemName: chip.icon).font(.system(size: 12, weight: .semibold))
                            }
                            Text(chip.label).font(T.footnoteM)
                            if !chip.count.isEmpty {
                                Text(chip.count).font(T.caption).opacity(0.7)
                            }
                        }
                        .foregroundColor(chip.active ? .black : .white)
                        .padding(.horizontal, 13).padding(.vertical, 8)
                        .background(Capsule().fill(chip.active ? Color.white : Color.white.opacity(0.12)))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var actions: some View {
        HStack(spacing: 10) {
            ForEach(Array(lib.actions.enumerated()), id: \.offset) { index, action in
                Button {
                    engine.send("action", [index])
                } label: {
                    HStack(spacing: 6) {
                        if !action.icon.isEmpty {
                            Image(systemName: action.icon).font(.system(size: 12, weight: .semibold))
                        }
                        Text(action.s.isEmpty ? action.label : action.s).font(T.footnoteM)
                    }
                    .foregroundColor(action.primary ? .black : .white)
                    .opacity(action.disabled ? 0.4 : 1)
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .background(Capsule().fill(action.primary ? Color.white : Color.white.opacity(0.12)))
                }
                .buttonStyle(.plain)
                .disabled(action.disabled)
            }
        }
    }

    /// Ряд треков из раздела: индексы — как в движке (строки подряд).
    private func rowsBlock(from: Int, n: Int) -> some View {
        let start = min(from, lib.tracks.count)
        let end = min(start + max(n, 0), lib.tracks.count)
        return VStack(spacing: 2) {
            ForEach(Array(lib.tracks[start..<end].enumerated()), id: \.offset) { i, track in
                TrackRow(track: track, index: i, onPlay: {
                    engine.send("row", [from + i])
                }, onMenu: {
                    engine.send("rowMenu", [from + i])
                })
            }
        }
    }

    @ViewBuilder
    private var blocks: some View {
        ForEach(Array(lib.blocks.enumerated()), id: \.offset) { _, block in
            switch block {
            case .rows(let from, let n):
                rowsBlock(from: from, n: n)
            case .head(let s, let count):
                HStack(alignment: .firstTextBaseline) {
                    Text(s).font(T.title3).foregroundColor(.white)
                    if !count.isEmpty {
                        Text(count).font(T.footnote).foregroundColor(.white.opacity(0.5))
                    }
                    Spacer()
                }
            case .grid(let items):
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14)], spacing: 16) {
                    ForEach(items) { card in
                        TileCard(url: card.img, title: card.title, sub: card.sub, round: card.round, badge: card.badge) {
                            engine.send("click", [card.id])
                        }
                    }
                }
            case .strip(let items):
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 14) {
                        ForEach(items) { card in
                            TileCard(url: card.img, title: card.title, sub: card.sub, round: card.round) {
                                engine.send("click", [card.id])
                            }
                        }
                    }
                }
            case .hero(let name, let stats, let meta, let img, let banner, let buttons):
                VStack(alignment: .leading, spacing: 10) {
                    RemoteImage(url: img, corner: 14)
                        .frame(height: 220)
                        .frame(maxWidth: .infinity)
                        .clipped()
                    Text(name).font(T.title2).foregroundColor(.white)
                    if !stats.isEmpty {
                        Text(stats).font(T.subhead).foregroundColor(.white.opacity(0.65))
                    }
                    if !meta.isEmpty {
                        Text(meta).font(T.footnote).foregroundColor(.white.opacity(0.5))
                    }
                    HStack(spacing: 10) {
                        ForEach(buttons) { button in
                            Button {
                                engine.send("click", [button.id])
                            } label: {
                                HStack(spacing: 6) {
                                    if !button.icon.isEmpty {
                                        Image(systemName: button.icon).font(.system(size: 12, weight: .semibold))
                                    }
                                    Text(button.s).font(T.footnoteM)
                                }
                                .foregroundColor(button.primary ? .black : .white)
                                .opacity(button.disabled ? 0.4 : 1)
                                .padding(.horizontal, 14).padding(.vertical, 9)
                                .background(Capsule().fill(button.primary ? Color.white : Color.white.opacity(0.12)))
                            }
                            .buttonStyle(.plain)
                            .disabled(button.disabled)
                        }
                    }
                }
            case .group(let img, let title, let sub, let play):
                HStack(spacing: 12) {
                    RemoteImage(url: img, corner: 8)
                        .frame(width: 64, height: 64)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(title).font(T.headline).foregroundColor(.white)
                        if !sub.isEmpty {
                            Text(sub).font(T.footnote).foregroundColor(.white.opacity(0.6))
                        }
                    }
                    Spacer()
                    if play > 0 {
                        Button {
                            engine.send("click", [play])
                        } label: {
                            Image(systemName: "play.fill")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundColor(.black)
                                .frame(width: 38, height: 38)
                                .background(Circle().fill(.white))
                        }
                        .buttonStyle(.plain)
                    }
                }
            case .loading(let s):
                HStack(spacing: 10) {
                    ProgressView()
                    Text(s).font(T.subhead).foregroundColor(.white.opacity(0.6))
                }
            case .para(let s):
                Text(s).font(T.subhead).foregroundColor(.white.opacity(0.7))
            }
        }
    }
}

// Поиск: поле и результаты (результаты движок показывает в медиатеке).
struct SearchView: View {
    @ObservedObject var engine = Engine.shared
    @ObservedObject var nav = Nav.shared
    @State private var query = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(.white.opacity(0.5))
                TextField("Поиск", text: $query)
                    .font(T.body)
                    .foregroundColor(.white)
                    .textFieldStyle(.plain)
                    .focused($focused)
                    .submitLabel(.search)
                    .onSubmit { submit() }
                if !query.isEmpty {
                    Button {
                        query = ""
                        focused = true
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 15))
                            .foregroundColor(.white.opacity(0.4))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .glass(corner: 14)
            .padding(.horizontal, 18)
            .padding(.top, 10)

            ScrollView {
                VStack(spacing: 10) {
                    Text("Ищи по трекам, альбомам и артистам")
                        .font(T.subhead)
                        .foregroundColor(.white.opacity(0.5))
                        .padding(.top, 40)
                }
                .padding(.horizontal, 18)
            }
        }
        .padding(.bottom, 190)
        .onAppear { focused = true }
    }

    private func submit() {
        engine.send("search", [query, true])
        nav.go(.library)
    }
}
