import Foundation
import MediaPlayer
import UIKit

// Экран блокировки и Центр управления: то же, что на Android делает MediaService.
// Данные приходят из движка (bridge → mediaUpdate), кнопки уходят обратно в движок.
@MainActor
final class NowPlaying {
    static let shared = NowPlaying()

    struct State {
        var hasTrack = false
        var playing = false
        var title = ""
        var artist = ""
        var album = ""
        var cover = ""
        var pos: Double = 0
        var duration: Double = 0
        var barrel = false
    }

    private var state = State()
    private var commandsReady = false

    func update(_ s: State) {
        state = s
        var info: [String: Any] = [:]
        info[MPMediaItemPropertyTitle] = s.title
        info[MPMediaItemPropertyArtist] = s.artist
        info[MPMediaItemPropertyAlbumTitle] = s.album
        info[MPMediaItemPropertyPlaybackDuration] = s.duration
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = s.pos
        info[MPNowPlayingInfoPropertyPlaybackRate] = s.playing ? 1.0 : 0.0
        info[MPNowPlayingInfoPropertyMediaType] = MPNowPlayingInfoMediaType.audio.rawValue
        if !s.cover.isEmpty {
            if let image = NowPlaying.loadImage(s.cover) {
                info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            }
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = s.hasTrack ? info : nil
        if s.hasTrack { MPNowPlayingInfoCenter.default().playbackState = s.playing ? .playing : .paused }
        setupCommands()
    }

    /// Обложка для экрана блокировки: грузим сами (в WebView картинка может быть с прокси).
    private static func loadImage(_ urlString: String) -> UIImage? {
        guard let url = URL(string: urlString) else { return nil }
        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        if let data = try? Data(contentsOf: url), let image = UIImage(data: data) {
            return image
        }
        _ = request
        return nil
    }

    private func setupCommands() {
        guard !commandsReady else { return }
        commandsReady = true
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in Engine.shared.send("toggle") }
            _ = self
            return .success
        }
        center.pauseCommand.addTarget { _ in
            Task { @MainActor in Engine.shared.send("toggle") }
            return .success
        }
        center.togglePlayPauseCommand.addTarget { _ in
            Task { @MainActor in Engine.shared.send("toggle") }
            return .success
        }
        center.nextTrackCommand.addTarget { _ in
            Task { @MainActor in Engine.shared.send("next") }
            return .success
        }
        center.previousTrackCommand.addTarget { _ in
            Task { @MainActor in Engine.shared.send("prev") }
            return .success
        }
        center.changePlaybackPositionCommand.addTarget { event in
            guard let e = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            Task { @MainActor in Engine.shared.send("seek", [e.positionTime]) }
            return .success
        }
        center.skipForwardCommand.addTarget { _ in
            Task { @MainActor in Engine.shared.send("seek", [Engine.shared.player.posNow() + 15]) }
            return .success
        }
        center.skipBackwardCommand.addTarget { _ in
            Task { @MainActor in Engine.shared.send("seek", [max(0, Engine.shared.player.posNow() - 15)]) }
            return .success
        }
    }
}
