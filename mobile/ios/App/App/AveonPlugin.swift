import Foundation
import Capacitor
import AVFoundation
import PhotosUI
import UniformTypeIdentifiers
import UIKit

// Всё, чего нет у WebView на iOS: сеть без CORS (fetch), файлы данных (fs*), звонок (call),
// уведомление и экран блокировки (mediaUpdate), свои файлы (scanAudio, pickFolder, pickAudio),
// картинки (pickImage), голос диджея (speak), ссылки (openUrl), буфер обмена (copy).
// JS-сторона — mobile/bridge (та же, что на Android).
@objc(AveonPlugin)
public class AveonPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AveonPlugin"
    public let jsName = "Aveon"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "callState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBarrel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "mediaUpdate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fetch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fsLoad", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fsWrite", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fsWriteBinary", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fsDelete", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cacheDownload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cacheRemove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cacheClear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cacheList", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickFolder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "audioInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickImage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopSpeak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "copy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deviceName", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setFullscreen", returnType: CAPPluginReturnPromise),
    ]

    private var pendingFolder: CAPPluginCall? = nil
    private var pendingAudio: CAPPluginCall? = nil
    private var pendingImage: CAPPluginCall? = nil
    private let synthesizer = AVSpeechSynthesizer()

    override public func load() {
        CallMonitor.shared.start()
        startCallPolling()
    }

    // ---------- звонок ----------

    private func startCallPolling() {
        var last = CallMonitor.shared.inCall
        Timer.scheduledTimer(withTimeInterval: 0.7, repeats: true) { [weak self] _ in
            guard let self else { return }
            let now = CallMonitor.shared.inCall
            if now != last {
                last = now
                self.notifyListeners("call", data: CallMonitor.shared.state)
            }
        }
    }

    @objc func callState(_ call: CAPPluginCall) {
        call.resolve(CallMonitor.shared.state)
    }

    @objc func setBarrel(_ call: CAPPluginCall) {
        CallMonitor.shared.manual = call.getBool("on", false)
        call.resolve()
    }

    // ---------- уведомление и экран блокировки ----------

    @objc func mediaUpdate(_ call: CAPPluginCall) {
        var s = NowPlaying.State()
        s.hasTrack = call.getBool("hasTrack", false)
        s.playing = call.getBool("playing", false)
        s.title = call.getString("title", "")
        s.artist = call.getString("artist", "")
        s.album = call.getString("album", "")
        s.cover = call.getString("cover", "")
        s.pos = call.getDouble("pos", 0)
        s.duration = call.getDouble("duration", 0)
        s.barrel = CallMonitor.shared.manual
        Task { @MainActor in NowPlaying.shared.update(s) }
        call.resolve()
    }

    // ---------- сеть ----------

    @objc func fetch(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.resolve(["error": "bad url"])
            return
        }
        let method = call.getString("method", "GET").uppercased()
        let headers = call.getObject("headers", [:])
        let bodyB64 = call.getString("body")
        let timeout = call.getInt("timeout", 30000)

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = Double(timeout) / 1000.0
        for (k, v) in headers {
            if let s = v as? String { request.setValue(s, forHTTPHeaderField: k) }
        }
        if request.value(forHTTPHeaderField: "User-Agent") == nil {
            request.setValue(Net.userAgent, forHTTPHeaderField: "User-Agent")
        }
        if let b = bodyB64, let data = Data(base64Encoded: b, options: [.ignoreUnknownCharacters]) {
            request.httpBody = data
        }

        URLSession.shared.dataTask(with: request) { data, response, error in
            var out: [String: Any] = [:]
            if let error {
                out["error"] = "\(error.localizedDescription)"
            } else {
                if let http = response as? HTTPURLResponse {
                    out["status"] = http.statusCode
                    out["statusText"] = HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
                    out["url"] = http.url?.absoluteString ?? url.absoluteString
                    var h: [String: Any] = [:]
                    for (k, v) in http.allHeaderFields {
                        let key = (k as? String) ?? ""
                        h[key.lowercased()] = "\(v)"
                    }
                    out["headers"] = h
                }
                out["body"] = (data ?? Data()).base64EncodedString()
            }
            DispatchQueue.main.async { call.resolve(out) }
        }.resume()
    }

    // ---------- файлы данных ----------

    private func dataFile(_ name: String?) -> URL? {
        guard let name, !name.isEmpty, !name.contains(".."), !name.hasPrefix("/") else { return nil }
        return MediaStore.shared.dataDir.appendingPathComponent(name)
    }

    @objc func fsLoad(_ call: CAPPluginCall) {
        var files: [String: Any] = [:]
        let dir = MediaStore.shared.dataDir
        let items = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        for url in items where url.pathExtension == "json" {
            guard let raw = try? String(contentsOf: url, encoding: .utf8) else { continue }
            if let text = try? Vault.open(raw) {
                files[url.lastPathComponent] = text
            }
        }
        call.resolve(["files": files])
    }

    @objc func fsWrite(_ call: CAPPluginCall) {
        guard let file = dataFile(call.getString("name")) else {
            call.reject("bad name")
            return
        }
        do {
            let sealed = try Vault.seal(call.getString("text", ""))
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(),
                                                    withIntermediateDirectories: true)
            try Data(sealed.utf8).write(to: file, options: .atomic)
            call.resolve()
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func fsWriteBinary(_ call: CAPPluginCall) {
        guard let file = dataFile(call.getString("name")) else {
            call.reject("bad name")
            return
        }
        let b64 = call.getString("data", "")
        guard let data = Data(base64Encoded: b64, options: [.ignoreUnknownCharacters]) else {
            call.reject("bad data")
            return
        }
        do {
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(),
                                                    withIntermediateDirectories: true)
            try data.write(to: file, options: .atomic)
            call.resolve()
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func fsDelete(_ call: CAPPluginCall) {
        guard let file = dataFile(call.getString("name")) else {
            call.resolve()
            return
        }
        try? FileManager.default.removeItem(at: file)
        call.resolve()
    }

    // ---------- кэш треков ----------

    @objc func cacheDownload(_ call: CAPPluginCall) {
        guard let name = call.getString("name"),
              MediaStore.shared.cacheFile(named: name) != nil || name.range(of: "^[a-f0-9]{24}\\.(mp3|m4a|aac|ogg|webm|flac|jpg)$", options: .regularExpression) != nil else {
            call.reject("bad cache name")
            return
        }
        let urls = call.getArray("urls", []) as? [String] ?? []
        guard !urls.isEmpty else {
            call.reject("нет ссылок")
            return
        }
        let file = MediaStore.shared.cacheDir.appendingPathComponent(name)
        let part = file.appendingPathExtension("part")
        let session = URLSession(configuration: .ephemeral)
        var data = Data()
        var failed: String? = nil
        let group = DispatchGroup()
        for u in urls {
            group.enter()
            var request = URLRequest(url: URL(string: u) ?? URL(fileURLWithPath: "/dev/null"))
            request.setValue(Net.userAgent, forHTTPHeaderField: "User-Agent")
            session.dataTask(with: request) { d, response, error in
                defer { group.leave() }
                if let error {
                    failed = error.localizedDescription
                    return
                }
                if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                    failed = "HTTP \(http.statusCode)"
                    return
                }
                data.append(d ?? Data())
            }.resume()
        }
        group.notify(queue: .main) {
            if let failed {
                try? FileManager.default.removeItem(at: part)
                call.reject(failed)
                return
            }
            do {
                try data.write(to: part, options: .atomic)
                try? FileManager.default.removeItem(at: file)
                try FileManager.default.moveItem(at: part, to: file)
                let attrs = try? FileManager.default.attributesOfItem(atPath: file.path)
                let size = (attrs?[.size] as? NSNumber)?.intValue ?? data.count
                call.resolve(["size": size])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func cacheRemove(_ call: CAPPluginCall) {
        if let name = call.getString("name"), let file = MediaStore.shared.cacheFile(named: name) {
            try? FileManager.default.removeItem(at: file)
        }
        call.resolve()
    }

    @objc func cacheClear(_ call: CAPPluginCall) {
        let dir = MediaStore.shared.cacheDir
        let items = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        for url in items { try? FileManager.default.removeItem(at: url) }
        call.resolve()
    }

    @objc func cacheList(_ call: CAPPluginCall) {
        let dir = MediaStore.shared.cacheDir
        let items = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.fileSizeKey])) ?? []
        var files: [[String: Any]] = []
        for url in items {
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            files.append(["name": url.lastPathComponent, "size": size])
        }
        call.resolve(["files": files])
    }

    // ---------- свои файлы ----------

    @objc func scanAudio(_ call: CAPPluginCall) {
        let folders = call.getArray("folders", []) as? [String] ?? []
        Task {
            let items = await MediaStore.shared.scan(folders: folders)
            await MainActor.run { call.resolve(["items": items]) }
        }
    }

    @objc func pickFolder(_ call: CAPPluginCall) {
        pendingFolder = call
        DispatchQueue.main.async { [weak self] in
            guard let self, let vc = self.bridge?.viewController else { return }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
            picker.allowsMultipleSelection = false
            picker.delegate = self
            vc.present(picker, animated: true)
        }
    }

    @objc func pickAudio(_ call: CAPPluginCall) {
        pendingAudio = call
        DispatchQueue.main.async { [weak self] in
            guard let self, let vc = self.bridge?.viewController else { return }
            let types = MediaStore.audioExtensions.map { UTType(filenameExtension: $0) }.compactMap { $0 } + [.audio]
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: Array(Set(types)), asCopy: true)
            picker.allowsMultipleSelection = true
            picker.delegate = self
            vc.present(picker, animated: true)
        }
    }

    @objc func audioInfo(_ call: CAPPluginCall) {
        guard let uri = call.getString("uri") else {
            call.reject("нет uri")
            return
        }
        Task {
            let info = await MediaStore.shared.info(for: uri) ?? [:]
            await MainActor.run { call.resolve(info) }
        }
    }

    @objc func pickImage(_ call: CAPPluginCall) {
        pendingImage = call
        DispatchQueue.main.async { [weak self] in
            guard let self, let vc = self.bridge?.viewController else { return }
            var config = PHPickerConfiguration()
            config.filter = .images
            config.selectionLimit = 1
            let picker = PHPickerViewController(configuration: config)
            picker.delegate = self
            vc.present(picker, animated: true)
        }
    }

    // ---------- голос диджея волны ----------

    @objc func speak(_ call: CAPPluginCall) {
        let text = call.getString("text", "")
        let rate = call.getFloat("rate", 1.0)
        let pitch = call.getFloat("pitch", 1.0)
        guard !text.isEmpty else {
            call.resolve()
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let utter = AVSpeechUtterance(string: text)
            utter.voice = AVSpeechSynthesisVoice(language: "ru-RU")
            utter.rate = AVSpeechUtteranceDefaultSpeechRate * rate
            utter.pitchMultiplier = pitch
            self.synthesizer.speak(utter)
            call.resolve()
        }
    }

    @objc func stopSpeak(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.synthesizer.stopSpeaking(at: .immediate)
            call.resolve()
        }
    }

    // ---------- мелочи ----------

    @objc func openUrl(_ call: CAPPluginCall) {
        guard let string = call.getString("url"), let url = URL(string: string) else {
            call.reject("Не нашлось приложения, чтобы открыть ссылку")
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { ok in
                if ok { call.resolve() } else { call.reject("Не нашлось приложения, чтобы открыть ссылку") }
            }
        }
    }

    @objc func copy(_ call: CAPPluginCall) {
        let text = call.getString("text", "")
        DispatchQueue.main.async {
            UIPasteboard.general.string = text
            call.resolve()
        }
    }

    @objc func deviceName(_ call: CAPPluginCall) {
        let device = UIDevice.current
        var name = device.name
        if name.isEmpty { name = "iPhone" }
        call.resolve(["name": name])
    }

    @objc func setFullscreen(_ call: CAPPluginCall) {
        let on = call.getBool("on", false)
        DispatchQueue.main.async { [weak self] in
            guard let vc = self?.bridge?.viewController as? AveonViewController else { return }
            vc.setFullscreen(on)
            call.resolve()
        }
    }
}

// ---------- выбор файлов ----------

extension AveonPlugin: UIDocumentPickerDelegate {
    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        if let call = pendingFolder {
            pendingFolder = nil
            guard let folder = urls.first else {
                call.resolve([:])
                return
            }
            Task {
                let items = await MediaStore.shared.importFolder(folder)
                let path = folder.lastPathComponent + "/"
                await MainActor.run { call.resolve(["path": path, "items": items]) }
            }
            return
        }
        if let call = pendingAudio {
            pendingAudio = nil
            Task {
                let items = await MediaStore.shared.importFiles(urls)
                await MainActor.run { call.resolve(["items": items]) }
            }
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        if let call = pendingFolder {
            pendingFolder = nil
            call.resolve([:])
        }
        if let call = pendingAudio {
            pendingAudio = nil
            call.resolve(["items": []])
        }
    }
}

// ---------- выбор картинки ----------

extension AveonPlugin: PHPickerViewControllerDelegate {
    public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let call = pendingImage else { return }
        pendingImage = nil
        guard let provider = results.first?.itemProvider else {
            call.resolve([:])
            return
        }
        let typeId = provider.registeredTypeIdentifiers.first ?? "public.image"
        provider.loadDataRepresentation(forTypeIdentifier: typeId) { data, error in
            guard let data, data.count <= 16 * 1024 * 1024 else {
                DispatchQueue.main.async { call.reject(error?.localizedDescription ?? "Картинка больше 15 МБ") }
                return
            }
            let type = typeId.contains("png") ? "image/png" : (typeId.contains("webp") ? "image/webp" : "image/jpeg")
            DispatchQueue.main.async {
                call.resolve(["data": data.base64EncodedString(), "type": type])
            }
        }
    }
}
