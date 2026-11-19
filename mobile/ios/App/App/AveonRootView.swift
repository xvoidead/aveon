import SwiftUI
import UIKit

// Вкладки приложения.
enum AveonTab: String, CaseIterable, Identifiable {
    case home, wave, library, search

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: return "Главная"
        case .wave: return "Волна"
        case .library: return "Медиатека"
        case .search: return "Поиск"
        }
    }

    var icon: String {
        switch self {
        case .home: return "house.fill"
        case .wave: return "dot.radiowaves.left.and.right"
        case .library: return "square.stack.fill"
        case .search: return "magnifyingglass"
        }
    }
}

/// Что показывает раскрытый плеер: обложка, текст или очередь (как три режима Apple Music).
enum PlayerMode: String, CaseIterable {
    case art, lyrics, queue
}

/// Навигация приложения: вкладка, раскрыт ли плеер, что в нём показано.
final class Nav: ObservableObject {
    static let shared = Nav()
    @Published var tab: AveonTab = .home
    @Published var playerOpen = false
    @Published var mode: PlayerMode = .art

    func openPlayer(_ m: PlayerMode? = nil) {
        if let m { mode = m }
        withAnimation(.spring(response: 0.42, dampingFraction: 0.86)) { playerOpen = true }
    }

    func closePlayer() {
        withAnimation(.spring(response: 0.42, dampingFraction: 0.9)) { playerOpen = false }
    }

    func go(_ t: AveonTab) {
        withAnimation(.easeOut(duration: 0.18)) { tab = t }
    }
}

// Корень приложения: вкладки, мини-плеер снизу, раскрытый плеер поверх всего.
struct AveonRootView: View {
    @ObservedObject var engine = Engine.shared
    @ObservedObject var nav = Nav.shared
    @State private var showProfile = false
    @State private var showFriends = false
    @State private var showAuth = false
    @State private var showEq = false

    var body: some View {
        ZStack(alignment: .bottom) {
            Pal.apple.bg.ignoresSafeArea()

            Group {
                switch nav.tab {
                case .home: HomeView()
                case .wave: WaveView()
                case .library: LibraryView()
                case .search: SearchView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            BottomBar()
        }
        .preferredColorScheme(.dark)
        .overlay(alignment: .top) { ToastsView() }
        .overlay { if nav.playerOpen { PlayerLayer(mode: $nav.mode, onClose: { nav.closePlayer() }) } }
        .overlay { if engine.visualizerOpen { VisualizerView { engine.visualizerOpen = false } } }
        .overlay { if let w = engine.wrapped { WrappedView(wrapped: w) { engine.wrapped = nil } } }
        .overlay { if engine.menu != nil { MenuSheet() } }
        .overlay { if engine.ask != nil { AskDialog() } }
        .sheet(item: panelBinding) { panel in
            PanelSheet(panel: panel)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showProfile) {
            ProfileView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .onDisappear { engine.send("panelClose", ["profile"]) }
        }
        .sheet(isPresented: $showFriends) {
            FriendsView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .onDisappear { engine.send("panelClose", ["friends"]) }
        }
        .sheet(isPresented: $showAuth) {
            AuthView()
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .onDisappear { engine.send("panelClose", ["auth"]) }
        }
        .sheet(isPresented: $showEq) {
            EqView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .onChange(of: engine.panels.count) { _ in syncPanels() }
        .onChange(of: engine.panels.last?.key) { _ in syncPanels() }
        .onReceive(NotificationCenter.default.publisher(for: .aveonOpenProfile)) { _ in showProfile = true }
        .onReceive(NotificationCenter.default.publisher(for: .aveonOpenFriends)) { _ in showFriends = true }
        .onReceive(NotificationCenter.default.publisher(for: .aveonOpenSettings)) { _ in engine.send("settings") }
        .onReceive(NotificationCenter.default.publisher(for: .aveonOpenEq)) { _ in showEq = true }
    }

    /// Панели движка «вход», «профиль» и «друзья» рисуем по-своему — открываем свои экраны.
    /// «Вход» закрывается сам, когда движок его убирает (например, после входа в аккаунт).
    private func syncPanels() {
        let keys = engine.panels.map { $0.key }
        showAuth = keys.contains("auth")
        if keys.contains("profile") { showProfile = true }
        if keys.contains("friends") { showFriends = true }
    }

    private var panelBinding: Binding<PanelState?> {
        Binding(
            get: {
                let last = engine.panels.last
                if let key = last?.key, key == "auth" || key == "profile" || key == "friends" { return nil }
                return last
            },
            set: { newValue in
                if newValue == nil, let key = engine.panels.last?.key {
                    engine.send("panelClose", [key])
                }
            }
        )
    }
}

// Нижняя панель: мини-плеер и вкладки. Сверху — стеклянная плашка, как в iOS.
struct BottomBar: View {
    @ObservedObject var engine = Engine.shared
    @ObservedObject var nav = Nav.shared

    var body: some View {
        VStack(spacing: 10) {
            if engine.player.track != nil {
                MiniPlayer { nav.openPlayer() }
                    .padding(.horizontal, 10)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            HStack(spacing: 0) {
                ForEach(AveonTab.allCases) { t in
                    Button {
                        nav.go(t)
                    } label: {
                        VStack(spacing: 3) {
                            Image(systemName: t.icon)
                                .font(.system(size: 19, weight: .medium))
                            Text(t.title)
                                .font(T.tab)
                        }
                        .foregroundColor(nav.tab == t ? Pal.apple.accent : Color.white.opacity(0.75))
                        .frame(maxWidth: .infinity)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.top, 8)
            .padding(.bottom, 4)
            .glass(corner: 26)
            .padding(.horizontal, 10)
        }
        .padding(.bottom, 4)
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: engine.player.track?.id)
    }
}

/// Мини-плеер: тап — раскрыть плеер, свайп влево/вправо — следующий/предыдущий трек.
struct MiniPlayer: View {
    @ObservedObject var engine = Engine.shared
    var onOpen: () -> Void

    @State private var drag: CGFloat = 0

    var body: some View {
        let pl = engine.player
        HStack(spacing: 10) {
            RemoteImage(url: pl.track?.cover ?? "", corner: 8)
                .frame(width: 40, height: 40)
            VStack(alignment: .leading, spacing: 1) {
                Marquee(text: pl.track?.title ?? "", font: T.subheadM, color: .white)
                Text(subtitle(pl))
                    .font(T.footnote)
                    .foregroundColor(pl.barrel > 0.5 ? Pal.apple.voice : Color.white.opacity(0.6))
                    .lineLimit(1)
            }
            Spacer(minLength: 2)
            PlayButton(playing: pl.playing, size: 40, icon: 17, action: { engine.send("toggle") })
            IconButton(system: "forward.fill", size: 16, color: .white) { engine.send("next") }
                .frame(width: 34, height: 34)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .frame(height: 52)
        .glass(corner: 16)
        .offset(x: drag)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 12)
                .onChanged { value in
                    if abs(value.translation.width) > abs(value.translation.height) {
                        drag = value.translation.width
                    }
                }
                .onEnded { value in
                    let w = UIScreen.main.bounds.width - 40
                    if abs(value.translation.width) > w * 0.25 || abs(value.translation.width) > 120 {
                        engine.send(value.translation.width < 0 ? "next" : "prev")
                    }
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) { drag = 0 }
                }
        )
        .onTapGesture(perform: onOpen)
    }

    private func subtitle(_ pl: PlayerState) -> String {
        if pl.barrel > 0.5 { return "в бочке · \(pl.track?.artist ?? "")" }
        if let room = pl.room, room.members.count > 1 { return "вместе · \(pl.track?.artist ?? "")" }
        return pl.track?.artist ?? ""
    }
}

// Уведомления приложения — плашка сверху, как в iOS.
struct ToastsView: View {
    @ObservedObject var engine = Engine.shared

    var body: some View {
        VStack(spacing: 8) {
            ForEach(engine.toasts) { t in
                HStack(spacing: 8) {
                    if t.err {
                        Circle().fill(Pal.apple.danger).frame(width: 8, height: 8)
                    }
                    Text(t.msg)
                        .font(T.subheadM)
                        .foregroundColor(.white)
                        .multilineTextAlignment(.center)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .glass(corner: 20)
                .padding(.horizontal, 20)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: engine.toasts)
        .padding(.top, 6)
    }
}

extension Notification.Name {
    static let aveonOpenProfile = Notification.Name("aveon.open.profile")
    static let aveonOpenFriends = Notification.Name("aveon.open.friends")
    static let aveonOpenSettings = Notification.Name("aveon.open.settings")
    static let aveonOpenEq = Notification.Name("aveon.open.eq")
}
