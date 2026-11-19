import SwiftUI

// Друзья: список, чат и профиль друга — как в соцсетях.
struct FriendsView: View {
    @ObservedObject var engine = Engine.shared
    @State private var view = FriendsViewState()
    @State private var friends: [FriendOut] = []
    @State private var input = ""
    @State private var loaded = false

    var body: some View {
        Group {
            switch view.mode {
            case "chat": chat
            case "profile": friendProfile
            default: list
            }
        }
        .task { await load() }
    }

    // ---------- список ----------

    private var list: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                if friends.isEmpty {
                    EmptyBox(title: "Пока никого", text: "Добавь друзей по логину — и увидишь, что они слушают")
                }
                ForEach(friends) { friend in
                    Button {
                        engine.send("chatOpen", [friend.id])
                        Task { await load(force: true) }
                    } label: {
                        HStack(spacing: 12) {
                            RemoteImage(url: friend.avatar, corner: 1000)
                                .frame(width: 46, height: 46)
                                .clipShape(Circle())
                            VStack(alignment: .leading, spacing: 3) {
                                HStack(spacing: 6) {
                                    Text(friend.name)
                                        .font(T.subheadM)
                                        .foregroundColor(.white)
                                    if friend.unread > 0 {
                                        Text("\(friend.unread)")
                                            .font(T.caption)
                                            .foregroundColor(.black)
                                            .padding(.horizontal, 6).padding(.vertical, 1)
                                            .background(Capsule().fill(Pal.apple.accent))
                                    }
                                }
                                if let now = friend.now, let track = now.track {
                                    HStack(spacing: 5) {
                                        Image(systemName: now.playing ? "waveform" : "pause.fill")
                                            .font(.system(size: 10, weight: .semibold))
                                        Text("\(track.title) — \(track.artist)")
                                            .font(T.footnote)
                                            .lineLimit(1)
                                    }
                                    .foregroundColor(now.playing ? Pal.apple.voice : .white.opacity(0.5))
                                } else if !friend.since.isEmpty {
                                    Text("друг с \(friend.since)")
                                        .font(T.footnote)
                                        .foregroundColor(.white.opacity(0.45))
                                }
                            }
                            Spacer()
                            if friend.inRoom {
                                Image(systemName: "person.3.fill")
                                    .font(.system(size: 13))
                                    .foregroundColor(Pal.apple.voice)
                            }
                        }
                        .padding(.vertical, 10)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    Divider().overlay(Color.white.opacity(0.07)).padding(.leading, 58)
                }
            }
            .padding(.horizontal, 18)
        }
    }

    // ---------- чат ----------

    private var chat: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Button {
                    engine.send("chatBack")
                    Task { await load(force: true) }
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(Pal.apple.accent)
                }
                .buttonStyle(.plain)
                Text(view.friend?.name ?? "Чат")
                    .font(T.headline)
                    .foregroundColor(.white)
                Spacer()
                if let friend = view.friend, let now = friend.now, let track = now.track, now.playing {
                    HStack(spacing: 5) {
                        Image(systemName: "waveform")
                            .font(.system(size: 10, weight: .semibold))
                        Text(track.title)
                            .font(T.caption)
                            .lineLimit(1)
                    }
                    .foregroundColor(Pal.apple.voice)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    if view.loading { ProgressView().frame(maxWidth: .infinity) }
                    ForEach(view.messages) { message in
                        bubble(message)
                    }
                    if view.more {
                        Button {
                            engine.send("chatOlder")
                            Task { await load(force: true) }
                        } label: {
                            Text("показать ещё").font(T.footnote).foregroundColor(.white.opacity(0.6))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
            }

            HStack(spacing: 10) {
                Button {
                    engine.send("chatAttach")
                } label: {
                    Image(systemName: "paperclip")
                        .font(.system(size: 16))
                        .foregroundColor(.white.opacity(0.6))
                }
                .buttonStyle(.plain)
                TextField("Сообщение", text: $input, axis: .vertical)
                    .font(T.body)
                    .foregroundColor(.white)
                    .lineLimit(1...4)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(Capsule().fill(Color.white.opacity(0.1))
                        .overlay(Capsule().stroke(Color.white.opacity(0.08), lineWidth: 0.8)))
                Button {
                    let text = input
                    input = ""
                    engine.send("chatSend", [text])
                    Task { await load(force: true) }
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 24))
                        .foregroundColor(input.isEmpty ? .white.opacity(0.3) : Pal.apple.accent)
                }
                .buttonStyle(.plain)
                .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 10)
        }
    }

    private func bubble(_ message: MessageOut) -> some View {
        VStack(alignment: message.mine ? .trailing : .leading, spacing: 3) {
            if let track = message.track {
                HStack(spacing: 8) {
                    RemoteImage(url: track["cover"] ?? "", corner: 6)
                        .frame(width: 40, height: 40)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(track["title"] ?? "").font(T.footnoteM).foregroundColor(.white)
                        Text(track["artist"] ?? "").font(T.caption).foregroundColor(.white.opacity(0.6))
                    }
                }
                .padding(8)
                .glass(corner: 14)
            }
            if !message.text.isEmpty {
                Text(message.text)
                    .font(T.body)
                    .foregroundColor(.white)
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .background(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(message.mine ? Pal.apple.accent.opacity(0.85) : Color.white.opacity(0.12))
                    )
            }
            if !message.reactions.isEmpty {
                HStack(spacing: 4) {
                    ForEach(message.reactions) { r in
                        Text("\(r.e) \(r.n)")
                            .font(T.caption)
                            .foregroundColor(r.mine ? Pal.apple.accent : .white.opacity(0.7))
                    }
                }
            }
            Text(message.time)
                .font(T.caption)
                .foregroundColor(.white.opacity(0.35))
        }
        .frame(maxWidth: .infinity, alignment: message.mine ? .trailing : .leading)
    }

    // ---------- профиль друга ----------

    private var friendProfile: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 10) {
                    Button {
                        engine.send("fpBack")
                        Task { await load(force: true) }
                    } label: {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundColor(Pal.apple.accent)
                    }
                    .buttonStyle(.plain)
                    Spacer()
                }
                if let friend = view.friend {
                    VStack(spacing: 8) {
                        RemoteImage(url: friend.avatar, corner: 1000)
                            .frame(width: 88, height: 88)
                            .clipShape(Circle())
                        Text(friend.name).font(T.title2).foregroundColor(.white)
                        if !friend.login.isEmpty {
                            Text("@\(friend.login)").font(T.subhead).foregroundColor(.white.opacity(0.55))
                        }
                    }
                    .frame(maxWidth: .infinity)
                    HStack(spacing: 10) {
                        if !view.roomLabel.isEmpty {
                            Button {
                                engine.send("fpRoom")
                            } label: {
                                Text(view.roomLabel)
                                    .font(T.footnoteM)
                                    .foregroundColor(.black)
                                    .padding(.horizontal, 16).padding(.vertical, 10)
                                    .background(Capsule().fill(.white))
                            }
                            .buttonStyle(.plain)
                        }
                        Button {
                            engine.send("fpSync")
                        } label: {
                            Text("с его места")
                                .font(T.footnoteM)
                                .foregroundColor(.white)
                                .padding(.horizontal, 16).padding(.vertical, 10)
                                .background(Capsule().fill(Color.white.opacity(0.12)))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.horizontal, 18)
        }
    }

    private func load(force: Bool = false) async {
        if loaded && !force { return }
        if let o = await engine.obj("friendsView") {
            view = FriendsViewState(o)
        }
        let list = await engine.list("friendsList")
        if !list.isEmpty { friends = list.map { FriendOut($0) } }
        loaded = true
    }
}
