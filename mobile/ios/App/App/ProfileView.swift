import SwiftUI

// Профиль: как в соцсетях — кто ты, что подключено, и статистика по месяцам.
struct ProfileView: View {
    @ObservedObject var engine = Engine.shared
    @State private var profile = ProfileState()
    @State private var loaded = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                if !profile.conns.isEmpty { connections }
                if let devices = profile.devices, !devices.isEmpty { devicesList(devices) }
                stats
            }
            .padding(.horizontal, 18)
            .padding(.top, 12)
            .padding(.bottom, 40)
        }
        .task { await load() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 14) {
                RemoteImage(url: profile.avatar, corner: 1000)
                    .frame(width: 72, height: 72)
                    .clipShape(Circle())
                VStack(alignment: .leading, spacing: 3) {
                    Text(profile.name.isEmpty ? "Гость" : profile.name)
                        .font(T.title2)
                        .foregroundColor(.white)
                    if !profile.login.isEmpty {
                        Text("@\(profile.login)")
                            .font(T.subhead)
                            .foregroundColor(.white.opacity(0.6))
                    }
                    if !profile.host.isEmpty {
                        Text(profile.host)
                            .font(T.caption)
                            .foregroundColor(.white.opacity(0.45))
                    }
                }
                Spacer()
            }
            if !profile.sync.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: profile.syncing ? "arrow.triangle.2.circlepath" : "checkmark.icloud")
                        .font(.system(size: 12))
                    Text(profile.sync).font(T.footnote)
                }
                .foregroundColor(profile.error.isEmpty ? .white.opacity(0.55) : Pal.apple.danger)
            }
            if !profile.error.isEmpty {
                Text(profile.error).font(T.footnote).foregroundColor(Pal.apple.danger)
            }
            HStack(spacing: 10) {
                Button {
                    NotificationCenter.default.post(name: .aveonOpenFriends, object: nil)
                } label: {
                    Label("Друзья · \(profile.friends)", systemImage: "person.2.fill")
                        .font(T.footnoteM)
                        .foregroundColor(.white)
                        .padding(.horizontal, 14).padding(.vertical, 9)
                        .background(Capsule().fill(Color.white.opacity(0.12)))
                }
                .buttonStyle(.plain)
                Button {
                    NotificationCenter.default.post(name: .aveonOpenSettings, object: nil)
                } label: {
                    Label("Настройки", systemImage: "gearshape.fill")
                        .font(T.footnoteM)
                        .foregroundColor(.white)
                        .padding(.horizontal, 14).padding(.vertical, 9)
                        .background(Capsule().fill(Color.white.opacity(0.12)))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var connections: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Подключено")
            VStack(spacing: 0) {
                ForEach(profile.conns) { conn in
                    HStack(spacing: 12) {
                        Image(systemName: conn.on ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 16))
                            .foregroundColor(conn.on ? Pal.apple.accent : .white.opacity(0.35))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(conn.name).font(T.subheadM).foregroundColor(.white)
                            if !conn.detail.isEmpty {
                                Text(conn.detail).font(T.footnote).foregroundColor(.white.opacity(0.55))
                            }
                        }
                        Spacer()
                    }
                    .padding(.vertical, 9)
                    if conn.id != profile.conns.last?.id {
                        Divider().overlay(Color.white.opacity(0.08))
                    }
                }
            }
            .padding(.horizontal, 14)
            .glass(corner: 18)
        }
    }

    private func devicesList(_ devices: [ProfileState.Device]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Устройства")
            VStack(spacing: 0) {
                ForEach(devices) { device in
                    HStack(spacing: 12) {
                        Image(systemName: device.current ? "iphone.gen3" : "desktopcomputer")
                            .font(.system(size: 15))
                            .foregroundColor(.white.opacity(0.6))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(device.name).font(T.subhead).foregroundColor(.white)
                            Text(device.ago).font(T.caption).foregroundColor(.white.opacity(0.5))
                        }
                        Spacer()
                    }
                    .padding(.vertical, 9)
                }
            }
            .padding(.horizontal, 14)
            .glass(corner: 18)
        }
    }

    private var stats: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Button {
                    if profile.month.canPrev {
                        engine.send("profileMonth", [prevMonth(profile.month.key)])
                        Task { await load(force: true) }
                    }
                } label: {
                    Image(systemName: "chevron.left").font(.system(size: 13, weight: .bold)).foregroundColor(.white.opacity(0.6))
                }
                .buttonStyle(.plain)
                .disabled(!profile.month.canPrev)

                Spacer()
                Text(profile.month.label)
                    .font(T.title3)
                    .foregroundColor(.white)
                Spacer()

                Button {
                    if profile.month.canNext {
                        engine.send("profileMonth", [nextMonth(profile.month.key)])
                        Task { await load(force: true) }
                    }
                } label: {
                    Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundColor(.white.opacity(0.6))
                }
                .buttonStyle(.plain)
                .disabled(!profile.month.canNext)
            }

            HStack(spacing: 10) {
                statBox(value: profile.month.totalText, title: "всего")
                statBox(value: profile.month.avgText, title: "в среднем")
                statBox(value: "\(profile.month.plays)", title: "треков")
            }

            if !profile.month.days.isEmpty {
                daysChart
            }

            if !profile.month.artists.isEmpty {
                SectionHeader(title: "Артисты месяца")
                VStack(spacing: 8) {
                    ForEach(profile.month.artists.prefix(8)) { artist in
                        HStack(spacing: 10) {
                            RemoteImage(url: artist.cover, corner: 6)
                                .frame(width: 36, height: 36)
                            Text(artist.name).font(T.subhead).foregroundColor(.white)
                                .lineLimit(1)
                            Spacer()
                            Text(artist.text).font(T.footnote).foregroundColor(.white.opacity(0.55)).monospacedDigit()
                        }
                    }
                }
            }

            if !profile.month.tracks.isEmpty {
                SectionHeader(title: "Топ-треки")
                VStack(spacing: 2) {
                    ForEach(Array(profile.month.tracks.prefix(10).enumerated()), id: \.offset) { index, track in
                        TrackRow(track: track, index: index) {
                            engine.send("statsPlay", [profile.month.key, index])
                        }
                    }
                }
            }
        }
    }

    private func statBox(value: String, title: String) -> some View {
        VStack(spacing: 3) {
            Text(value)
                .font(T.title3)
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(title)
                .font(T.caption)
                .foregroundColor(.white.opacity(0.5))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .glass(corner: 16)
    }

    private var daysChart: some View {
        let days = profile.month.days
        let max = max(days.max() ?? 1, 1)
        return VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "По дням")
            HStack(alignment: .bottom, spacing: 3) {
                ForEach(Array(days.enumerated()), id: \.offset) { index, value in
                    let h = max(CGFloat(value) / CGFloat(max) * 60, value > 0 ? 3 : 1)
                    RoundedRectangle(cornerRadius: 2)
                        .fill(index + 1 == profile.month.today ? Pal.apple.accent : Color.white.opacity(0.22))
                        .frame(height: h)
                }
            }
            .frame(height: 64, alignment: .bottom)
        }
    }

    private func load(force: Bool = false) async {
        if loaded && !force { return }
        guard let o = await engine.obj("profileData") else { return }
        profile = ProfileState(o)
        loaded = true
    }

    private func prevMonth(_ key: String) -> String {
        guard let parts = key.split(separator: "-").first(2).map(String.init), parts.count == 2,
              let m = Int(parts[1]), let y = Int(parts[0]) else { return key }
        return m == 1 ? "\(y - 1)-12" : "\(y)-\(String(format: "%02d", m - 1))"
    }

    private func nextMonth(_ key: String) -> String {
        guard let parts = key.split(separator: "-").first(2).map(String.init), parts.count == 2,
              let m = Int(parts[1]), let y = Int(parts[0]) else { return key }
        return m == 12 ? "\(y + 1)-01" : "\(y)-\(String(format: "%02d", m + 1))"
    }
}
