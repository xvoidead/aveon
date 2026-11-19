import SwiftUI
import UIKit

// Общие детали интерфейса: картинки, стеклянные плашки, кнопки, строка трека, шкала.

/// Кэш обложек: одна и та же картинка грузится один раз.
final class ImageCache {
    static let shared = ImageCache()
    private let cache = NSCache<NSURL, UIImage>()
    private let session = URLSession.shared

    func image(for urlString: String, completion: @escaping (UIImage?) -> Void) {
        guard !urlString.isEmpty, let url = URL(string: urlString) else {
            completion(nil)
            return
        }
        if let hit = cache.object(forKey: url as NSURL) {
            completion(hit)
            return
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        session.dataTask(with: request) { data, _, _ in
            let image = data.flatMap { UIImage(data: $0) }
            if let image { self.cache.setObject(image, forKey: url as NSURL) }
            DispatchQueue.main.async { completion(image) }
        }.resume()
    }
}

struct RemoteImage: View {
    let url: String
    var corner: CGFloat = 8
    var placeholder: Color = Color.white.opacity(0.08)
    @State private var image: UIImage? = nil

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: .fill)
            } else {
                Rectangle().fill(placeholder)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: corner, style: .continuous))
        .onAppear(perform: load)
        .onChange(of: url) { _ in load() }
    }

    private func load() {
        guard image == nil else { return }
        ImageCache.shared.image(for: url) { image = $0 }
    }
}

/// Плашка со стеклом: полупрозрачный фон, тонкая рамка, скругление.
struct Glass: ViewModifier {
    var corner: CGFloat = 20
    var tint: Color = .black

    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: corner, style: .continuous)
                    .fill(tint.opacity(0.72))
            )
            .overlay(
                RoundedRectangle(cornerRadius: corner, style: .continuous)
                    .stroke(Color.white.opacity(0.10), lineWidth: 0.8)
            )
            .clipShape(RoundedRectangle(cornerRadius: corner, style: .continuous))
    }
}

extension View {
    func glass(corner: CGFloat = 20, tint: Color = .black) -> some View {
        modifier(Glass(corner: corner, tint: tint))
    }
}

/// Круглая кнопка-иконка.
struct IconButton: View {
    var system: String
    var size: CGFloat = 22
    var color: Color = .primary
    var background: Color = .clear
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.system(size: size, weight: .medium))
                .foregroundColor(color)
                .frame(width: size * 2, height: size * 2)
                .background(Circle().fill(background))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
    }
}

/// Пауза ↔ играть.
struct PlayButton: View {
    var playing: Bool
    var size: CGFloat = 44
    var icon: CGFloat = 20
    var color: Color = .white
    var background: Color = .clear
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: playing ? "pause.fill" : "play.fill")
                .font(.system(size: icon, weight: .bold))
                .foregroundColor(color)
                .frame(width: size, height: size)
                .background(Circle().fill(background))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
    }
}

/// Бегущая строка: как в плеере, длинное название едет по кругу.
struct Marquee: View {
    let text: String
    var font: Font = T.subheadM
    var color: Color = .primary

    @State private var offset: CGFloat = 0
    @State private var textWidth: CGFloat = 0
    @State private var boxWidth: CGFloat = 0

    var body: some View {
        GeometryReader { geo in
            Text(text)
                .font(font)
                .foregroundColor(color)
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
                .background(
                    GeometryReader { g in
                        Color.clear.onAppear { textWidth = g.size.width }
                    }
                )
                .offset(x: offset)
                .onAppear { boxWidth = geo.size.width }
                .onChange(of: text) { _ in offset = 0 }
                .onChange(of: geo.size.width) { _ in boxWidth = geo.size.width }
        }
        .clipped()
        .onAppear(perform: start)
        .onChange(of: text) { _ in start() }
    }

    private func start() {
        offset = 0
        guard textWidth > boxWidth, boxWidth > 0 else { return }
        let distance = textWidth - boxWidth
        withAnimation(.linear(duration: Double(distance) / 30).delay(1.2).repeatForever(autoreverses: false)) {
            offset = -distance
        }
    }
}

/// Шкала трека: перемотка пальцем.
struct Scrubber: View {
    var value: Double
    var duration: Double
    var accent: Color = .accentColor
    var onSeek: (Double) -> Void

    @GestureState private var dragging: CGFloat?

    var body: some View {
        GeometryReader { geo in
            let w = max(geo.size.width, 1)
            let pos: Double = {
                if let d = dragging {
                    return Double(min(max(d / w, 0), 1)) * duration
                }
                return value
            }()
            let x = duration > 0 ? CGFloat(pos / duration) * w : 0
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.16)).frame(height: 5)
                Capsule().fill(accent).frame(width: max(x, 3), height: 5)
                Circle().fill(.white)
                    .frame(width: dragging == nil ? 11 : 15, height: dragging == nil ? 11 : 15)
                    .offset(x: x - (dragging == nil ? 5.5 : 7.5))
                    .shadow(radius: 3)
            }
            .frame(height: 20)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .updating($dragging) { value, state, _ in
                        state = value.location.x
                    }
                    .onEnded { value in
                        let ratio = min(max(value.location.x / w, 0), 1)
                        onSeek(Double(ratio) * duration)
                    }
            )
        }
        .frame(height: 20)
    }
}

/// Строка трека в списке.
struct TrackRow: View {
    let track: Track
    var index: Int? = nil
    var accent: Color = .accentColor
    var onPlay: () -> Void
    var onMenu: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 12) {
            if let index {
                Text("\(index + 1)")
                    .font(T.footnote)
                    .foregroundColor(.secondary)
                    .frame(width: 22, alignment: .trailing)
            }
            RemoteImage(url: track.cover, corner: 6)
                .frame(width: 44, height: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(track.title.isEmpty ? "без названия" : track.title)
                    .font(T.subheadM)
                    .foregroundColor(.primary)
                    .lineLimit(1)
                if !track.artist.isEmpty {
                    Text(track.artist)
                        .font(T.footnote)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            if let onMenu {
                Button(action: onMenu) {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(.secondary)
                        .frame(width: 30, height: 30)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            } else if track.duration > 0 {
                Text(AveonKit.time(track.duration))
                    .font(T.caption)
                    .foregroundColor(.secondary)
                    .monospacedDigit()
            }
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onPlay)
    }
}

/// Заголовок раздела.
struct SectionHeader: View {
    let title: String
    var action: String? = nil
    var onAction: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(T.title3)
                .foregroundColor(.primary)
            Spacer()
            if let action, let onAction {
                Button(action: onAction) {
                    HStack(spacing: 2) {
                        Text(action).font(T.subhead)
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold))
                    }
                    .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// Плитка «обложка + подпись» — как в Apple Music.
struct TileCard: View {
    let url: String
    let title: String
    var sub: String = ""
    var round: Bool = false
    var badge: String = ""
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 7) {
                ZStack(alignment: .topTrailing) {
                    if round {
                        RemoteImage(url: url, corner: 1000)
                            .frame(width: 150, height: 150)
                            .clipShape(Circle())
                    } else {
                        RemoteImage(url: url, corner: 10)
                            .frame(width: 150, height: 150)
                    }
                    if !badge.isEmpty {
                        Text(badge)
                            .font(T.caption)
                            .padding(.horizontal, 7).padding(.vertical, 3)
                            .background(Capsule().fill(.black.opacity(0.6)))
                            .foregroundColor(.white)
                            .padding(6)
                    }
                }
                Text(title)
                    .font(T.subheadM)
                    .foregroundColor(.primary)
                    .lineLimit(1)
                if !sub.isEmpty {
                    Text(sub)
                        .font(T.footnote)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .buttonStyle(.plain)
    }
}

/// Пустое состояние.
struct EmptyBox: View {
    let title: String
    var text: String = ""
    var loading: Bool = false

    var body: some View {
        VStack(spacing: 10) {
            if loading {
                ProgressView().controlSize(.large)
            }
            Text(title)
                .font(T.headline)
                .foregroundColor(.primary)
            if !text.isEmpty {
                Text(text)
                    .font(T.subhead)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }
}

enum AveonKit {
    /// Время в «м:сс» (или «ч:мм:сс»).
    static func time(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        let s = Int(seconds.rounded())
        let h = s / 3600, m = (s % 3600) / 60, sec = s % 60
        if h > 0 { return String(format: "%d:%02d:%02d", h, m, sec) }
        return String(format: "%d:%02d", m, sec)
    }

    /// «5 минут» / «1 час 20 минут».
    static func duration(_ seconds: Double) -> String {
        let s = Int(max(0, seconds))
        let h = s / 3600, m = (s % 3600) / 60
        if h > 0 { return "\(h) ч \(m) мин" }
        if m > 0 { return "\(m) мин" }
        return "\(s) сек"
    }
}
