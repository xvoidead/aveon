import Foundation
import AVFoundation
import UniformTypeIdentifiers

// Свои файлы на iOS: то, что пользователь добавил из «Файлов» (или папку целиком), лежит в
// контейнере приложения. Движок знает их по ключу (относительный путь), а играет и показывает
// обложку через /_media/local и /_media/cover — как на Android через content:// и WebViewClient.
final class MediaStore {
    static let shared = MediaStore()

    private let fm = FileManager.default

    /// Корень данных приложения: /aveon (JSON с настройками), /aveon/covers (свои обложки),
    /// /aveon/cache-audio (кэш треков), /aveon/media (свои файлы).
    var dataDir: URL {
        let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fm.urls(for: .documentDirectory, in: .userDomainMask).first!
        let dir = base.appendingPathComponent("aveon", isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    var mediaDir: URL {
        let dir = dataDir.appendingPathComponent("media", isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    var coversDir: URL {
        let dir = dataDir.appendingPathComponent("covers", isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    var cacheDir: URL {
        let dir = dataDir.appendingPathComponent("cache-audio", isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static let audioExtensions: Set<String> = ["mp3", "flac", "wav", "ogg", "oga", "opus", "m4a", "aac", "webm", "weba"]

    static func mime(of name: String) -> String {
        if name.hasSuffix(".png") { return "image/png" }
        if name.hasSuffix(".webp") { return "image/webp" }
        return "image/jpeg"
    }

    // ---------- свои файлы ----------

    /// Файл по ключу (относительный путь внутри media).
    func file(for key: String) -> URL? {
        guard !key.isEmpty, !key.contains(".."), !key.hasPrefix("/") else { return nil }
        let url = mediaDir.appendingPathComponent(key)
        guard fm.fileExists(atPath: url.path) else { return nil }
        return url
    }

    /// Обложка из тегов файла (мы вытащили её при импорте).
    func cover(for key: String) -> Data? {
        guard let url = coverFile(for: key), let data = try? Data(contentsOf: url) else { return nil }
        return data
    }

    private func coverFile(for key: String) -> URL? {
        guard let url = file(for: key) else { return nil }
        let art = mediaDir.appendingPathComponent(url.deletingPathExtension().lastPathComponent + ".jpg")
        return fm.fileExists(atPath: art.path) ? art : nil
    }

    /// Своя обложка из редактора тегов (движок пишет их в /aveon/covers).
    func artFile(named name: String) -> URL? {
        guard name.range(of: "^[a-f0-9]{40}-\\d+\\.(jpg|png|webp)$", options: .regularExpression) != nil else { return nil }
        let url = coversDir.appendingPathComponent(name)
        return fm.fileExists(atPath: url.path) ? url : nil
    }

    /// Файл кэша трека (имя как у движка: hex + расширение).
    func cacheFile(named name: String) -> URL? {
        guard name.range(of: "^[a-f0-9]{24}\\.(mp3|m4a|aac|ogg|webm|flac|jpg)(\\.part)?$", options: .regularExpression) != nil else { return nil }
        let url = cacheDir.appendingPathComponent(name)
        return fm.fileExists(atPath: url.path) ? url : nil
    }

    /// Все свои файлы (ключ → данные). Фильтр по папкам — как в Android («Music/Rock/»).
    func scan(folders: [String]) async -> [JObj] {
        var items: [JObj] = []
        for key in listKeys() {
            let folder = (key as NSString).deletingLastPathComponent
            if !folders.isEmpty && !MediaStore.inFolder(folder, folders) { continue }
            guard let info = await info(for: key) else { continue }
            items.append(info)
        }
        return items
    }

    private static func inFolder(_ folder: String, _ folders: [String]) -> Bool {
        let clean = folder.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        for f in folders {
            let want = f.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            if want.isEmpty { return true }
            if clean == want || clean.hasPrefix(want + "/") { return true }
        }
        return false
    }

    private func listKeys() -> [String] {
        var out: [String] = []
        guard let en = fm.enumerator(at: mediaDir, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles]) else { return out }
        for case let url as URL in en {
            guard let vals = try? url.resourceValues(forKeys: [.isRegularFileKey]), vals.isRegularFile == true else { continue }
            let key = url.path.replacingOccurrences(of: mediaDir.path + "/", with: "")
            if key.hasSuffix(".jpg") { continue } // вытащенная обложка
            out.append(key)
        }
        return out
    }

    /// Метаданные файла: то, что движок показывает в списках.
    /// Длительность — в миллисекундах (как у MediaStore на Android).
    func info(for key: String) async -> JObj? {
        guard let url = file(for: key) else { return nil }
        let name = url.lastPathComponent
        let meta = await readMetadata(url)
        let hasArt = fm.fileExists(atPath: mediaDir.appendingPathComponent(url.deletingPathExtension().lastPathComponent + ".jpg").path)
        var o: JObj = [
            "uri": key,
            "name": name,
            "title": meta.title ?? "",
            "artist": meta.artist ?? "",
            "album": meta.album ?? "",
            "duration": meta.duration * 1000,
            "hasArt": hasArt,
            "folder": (key as NSString).deletingLastPathComponent,
        ]
        if meta.title == nil || (meta.title ?? "").isEmpty {
            o["title"] = (name as NSString).deletingPathExtension
        }
        return o
    }

    struct Meta {
        var title: String? = nil
        var artist: String? = nil
        var album: String? = nil
        var duration: Double = 0
    }

    private func readMetadata(_ url: URL) async -> Meta {
        var meta = Meta()
        let asset = AVURLAsset(url: url)
        do {
            let duration = try await asset.load(.duration)
            meta.duration = duration.seconds.isFinite ? duration.seconds : 0
            let items = try await asset.load(.commonMetadata)
            for item in items {
                guard let key = item.commonKey else { continue }
                let value = try? await item.load(.stringValue)
                switch key {
                case .commonKeyTitle: if meta.title == nil { meta.title = value ?? nil }
                case .commonKeyArtist, .commonKeyAuthor: if meta.artist == nil { meta.artist = value ?? nil }
                case .commonKeyAlbumName: if meta.album == nil { meta.album = value ?? nil }
                default: break
                }
            }
        } catch {
            // без метаданных — имя файла
        }
        return meta
    }

    /// Импорт файлов из «Файлов»: копируем в контейнер, вытаскиваем обложку и метаданные.
    func importFiles(_ urls: [URL], into folder: String? = nil) async -> [JObj] {
        var out: [JObj] = []
        for url in urls {
            let ext = url.pathExtension.lowercased()
            guard MediaStore.audioExtensions.contains(ext) else { continue }
            var key: String
            if let folder, !folder.isEmpty {
                key = folder.hasSuffix("/") ? folder + url.lastPathComponent : folder + "/" + url.lastPathComponent
            } else {
                key = url.lastPathComponent
            }
            // совпадения имён не затирают друг друга
            var candidate = key
            var n = 1
            while fm.fileExists(atPath: mediaDir.appendingPathComponent(candidate).path) {
                let base = (key as NSString).deletingPathExtension
                let ext2 = (key as NSString).pathExtension
                candidate = ext2.isEmpty ? "\(base) (\(n))" : "\(base) (\(n)).\(ext2)"
                n += 1
            }
            key = candidate
            let dest = mediaDir.appendingPathComponent(key)
            try? fm.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
            do {
                try fm.copyItem(at: url, to: dest)
            } catch {
                continue
            }
            await extractArtwork(from: dest, named: (key as NSString).deletingPathExtension)
            if let info = await info(for: key) { out.append(info) }
        }
        return out
    }

    /// Импорт папки целиком (вложенные — тоже).
    func importFolder(_ url: URL) async -> [JObj] {
        let name = url.lastPathComponent
        var files: [URL] = []
        if let en = fm.enumerator(at: url, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles]) {
            for case let f as URL in en {
                let ext = f.pathExtension.lowercased()
                if MediaStore.audioExtensions.contains(ext) { files.append(f) }
            }
        }
        var out: [JObj] = []
        for f in files {
            let rel = f.path.replacingOccurrences(of: url.path + "/", with: "")
            let key = "\(name)/\(rel)"
            let dest = mediaDir.appendingPathComponent(key)
            try? fm.createDirectory(at: dest.deletingPathExtension(), withIntermediateDirectories: true)
            do {
                try fm.copyItem(at: f, to: dest)
            } catch {
                continue
            }
            await extractArtwork(from: dest, named: (key as NSString).deletingPathExtension)
            if let info = await info(for: key) { out.append(info) }
        }
        return out
    }

    /// Обложка из тегов — сохраняем рядом с файлом, чтобы отдавать быстро.
    private func extractArtwork(from url: URL, named name: String) async {
        let asset = AVURLAsset(url: url)
        guard let items = try? await asset.load(.commonMetadata) else { return }
        for item in items {
            guard item.commonKey == .commonKeyArtwork else { continue }
            if let data = try? await item.load(.dataValue), let data, !data.isEmpty {
                let out = MediaStore.shared.mediaDir.appendingPathComponent(name + ".jpg")
                try? data.write(to: out)
                return
            }
        }
    }
}
