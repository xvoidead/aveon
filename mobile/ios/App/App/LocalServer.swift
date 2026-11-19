import Foundation
import Network

// Локальный сервер приложения: отдаёт веб-часть плеера и всё, что приходит из интернета.
// На iOS страница живёт на http://127.0.0.1:port — оттуда же она берёт обложки и сам поток
// (через /proxy?u=…). Пока адрес один и тот же, картинка читается (палитра из обложки), а звук
// отдаётся в Web Audio (бочка, эквалайзер). На Android ту же роль играет перехват запросов
// с CORS-заголовками (AveonWebViewClient).
final class LocalServer {
    static let shared = LocalServer()

    private var listener: NWListener?
    private let queue = DispatchQueue(label: "aveon.http")
    private(set) var port: UInt16 = 0

    /// Корень веб-части: public внутри приложения (кладёт `cap copy ios`).
    var webRoot: URL? {
        Bundle.main.resourceURL?.appendingPathComponent("public", isDirectory: true)
    }

    var origin: String { "http://127.0.0.1:\(port)" }

    private(set) var running = false

    func start() {
        guard listener == nil else { return }
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        guard let l = try? NWListener(using: params, on: .any) else { return }
        listener = l
        l.stateUpdateHandler = { [weak self] state in
            if case .ready = state {
                self?.port = l.port?.rawValue ?? 0
                self?.running = true
            }
            if case .failed = state {
                self?.running = false
            }
        }
        l.newConnectionHandler = { [weak self] conn in
            self?.handle(conn)
        }
        l.start(queue: queue)
    }

    /// Поднимаем сервер и ждём готовности: порт нужен до загрузки страницы.
    @discardableResult
    func startAndWait(timeout: TimeInterval = 3.0) -> Bool {
        if running && port > 0 { return true }
        if listener != nil { return running }
        let sem = DispatchSemaphore(value: 0)
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        guard let l = try? NWListener(using: params, on: .any) else { return false }
        listener = l
        l.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                self?.port = l.port?.rawValue ?? 0
                self?.running = true
                sem.signal()
            case .failed:
                self?.running = false
                sem.signal()
            default:
                break
            }
        }
        l.newConnectionHandler = { [weak self] conn in
            self?.handle(conn)
        }
        l.start(queue: queue)
        _ = sem.wait(timeout: .now() + timeout)
        return running
    }

    func stop() {
        listener?.cancel()
        listener = nil
        running = false
    }

    // ---------- разбор запроса ----------

    private struct Request {
        var method = "GET"
        var path = "/"
        var query: [String: String] = [:]
        var headers: [String: String] = [:]
    }

    private func handle(_ conn: NWConnection) {
        conn.start(queue: queue)
        var buffer = Data()
        var done = false

        func receive() {
            conn.receive(minimumIncompleteLength: 1, maximumLength: 1 << 16) { data, _, isComplete, error in
                if let d = data, !d.isEmpty { buffer.append(d) }
                if let req = self.parse(buffer) {
                    done = true
                    self.respond(conn, req)
                    return
                }
                if isComplete || error != nil {
                    if !done {
                        done = true
                        self.send(conn, status: 400, reason: "Bad Request", headers: self.cors(), body: Data())
                    }
                    return
                }
                receive()
            }
        }
        receive()
    }

    private func parse(_ data: Data) -> Request? {
        guard let sepRange = data.range(of: Data("\r\n\r\n".utf8)) else { return nil }
        let head = String(data: data[..<sepRange.lowerBound], encoding: .utf8) ?? ""
        var lines = head.components(separatedBy: "\r\n")
        guard !lines.isEmpty else { return nil }
        let requestLine = lines.removeFirst().split(separator: " ").map(String.init)
        guard requestLine.count >= 2 else { return nil }
        var req = Request()
        req.method = requestLine[0]
        let target = requestLine[1]
        if let q = target.firstIndex(of: "?") {
            req.path = String(target[..<q])
            let items = target[target.index(after: q)...].components(separatedBy: "&")
            for it in items {
                let kv = it.split(separator: "=", maxSplits: 1).map(String.init)
                guard kv.count == 2 else { continue }
                req.query[kv[0]] = kv[1].removingPercentEncoding ?? kv[1]
            }
        } else {
            req.path = target
        }
        for line in lines {
            let kv = line.split(separator: ":", maxSplits: 1).map(String.init)
            if kv.count == 2 {
                req.headers[kv[0].lowercased()] = kv[1].trimmingCharacters(in: .whitespaces)
            }
        }
        return req
    }

    // ---------- ответы ----------

    private func cors() -> [String: String] {
        ["Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Expose-Headers": "*"]
    }

    private func send(_ conn: NWConnection, status: Int, reason: String, headers: [String: String], body: Data) {
        var head = "HTTP/1.1 \(status) \(reason)\r\n"
        for (k, v) in headers { head += "\(k): \(v)\r\n" }
        head += "Content-Length: \(body.count)\r\n"
        head += "Connection: close\r\n\r\n"
        var out = Data(head.utf8)
        out.append(body)
        conn.send(content: out, completion: .contentProcessed { _ in conn.cancel() })
    }

    private func respond(_ conn: NWConnection, _ req: Request) {
        if req.path.hasPrefix("/_media/") {
            media(conn, req)
            return
        }
        if req.path == "/proxy" {
            proxy(conn, req)
            return
        }
        if req.method == "OPTIONS" {
            send(conn, status: 204, reason: "No Content", headers: cors(), body: Data())
            return
        }
        staticFile(conn, req)
    }

    // ---------- веб-часть ----------

    private func staticFile(_ conn: NWConnection, _ req: Request) {
        guard let root = webRoot else {
            send(conn, status: 404, reason: "Not Found", headers: cors(), body: Data())
            return
        }
        var path = req.path
        if path.hasSuffix("/") { path += "index.html" }
        let clean = path.hasPrefix("/") ? String(path.dropFirst()) : path
        let file = root.appendingPathComponent(clean)
        // не выпускаем за пределы public
        let rootPath = root.standardizedFileURL.path
        guard file.standardizedFileURL.path.hasPrefix(rootPath) else {
            send(conn, status: 403, reason: "Forbidden", headers: cors(), body: Data())
            return
        }
        guard let data = try? Data(contentsOf: file) else {
            send(conn, status: 404, reason: "Not Found", headers: cors(), body: Data())
            return
        }
        var h = cors()
        h["Content-Type"] = mime(for: file.pathExtension)
        h["Cache-Control"] = "no-cache"
        send(conn, status: 200, reason: "OK", headers: h, body: data)
    }

    private func mime(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        case "gif": return "image/gif"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "ttf": return "font/ttf"
        case "mp3": return "audio/mpeg"
        case "m4a": return "audio/mp4"
        case "aac": return "audio/aac"
        case "ogg": return "audio/ogg"
        case "opus": return "audio/ogg"
        case "flac": return "audio/flac"
        case "wav": return "audio/wav"
        case "webm": return "audio/webm"
        case "m3u8": return "application/vnd.apple.mpegurl"
        case "txt": return "text/plain; charset=utf-8"
        default: return "application/octet-stream"
        }
    }

    // ---------- свои файлы ----------

    private func media(_ conn: NWConnection, _ req: Request) {
        let kind = String(req.path.dropFirst("/_media/".count))
        switch kind {
        case "local":
            guard let p = req.query["p"], let url = MediaStore.shared.file(for: p) else {
                send(conn, status: 404, reason: "Not Found", headers: cors(), body: Data())
                return
            }
            sendFile(conn, req, url)
        case "cover":
            guard let p = req.query["p"], let data = MediaStore.shared.cover(for: p) else {
                send(conn, status: 404, reason: "Not Found", headers: cors(), body: Data())
                return
            }
            var h = cors()
            h["Content-Type"] = "image/jpeg"
            h["Cache-Control"] = "max-age=86400"
            send(conn, status: 200, reason: "OK", headers: h, body: data)
        case "art":
            guard let f = req.query["f"], let url = MediaStore.shared.artFile(named: f), let data = try? Data(contentsOf: url) else {
                send(conn, status: 404, reason: "Not Found", headers: cors(), body: Data())
                return
            }
            var h = cors()
            h["Content-Type"] = MediaStore.mime(of: f)
            h["Cache-Control"] = "max-age=31536000"
            send(conn, status: 200, reason: "OK", headers: h, body: data)
        case "cache":
            guard let f = req.query["f"], let url = MediaStore.shared.cacheFile(named: f) else {
                send(conn, status: 404, reason: "Not Found", headers: cors(), body: Data())
                return
            }
            sendFile(conn, req, url)
        default:
            send(conn, status: 404, reason: "Not Found", headers: cors(), body: Data())
        }
    }

    /// Файл с перемоткой: Range → 206, как в Electron и на Android.
    private func sendFile(_ conn: NWConnection, _ req: Request, _ url: URL) {
        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        let total = (attrs?[.size] as? NSNumber)?.intValue ?? 0
        guard total > 0 else {
            send(conn, status: 404, reason: "Not Found", headers: cors(), body: Data())
            return
        }
        var headers = cors()
        headers["Content-Type"] = mime(for: url.pathExtension)
        headers["Accept-Ranges"] = "bytes"

        var start = 0
        var end = total - 1
        var partial = false
        if let range = req.headers["range"] {
            let spec = range.replacingOccurrences(of: "bytes=", with: "")
            let parts = spec.split(separator: "-", maxSplits: 1).map(String.init)
            if parts.count == 2 {
                if parts[0].isEmpty, let last = Int(parts[1]) {
                    start = max(0, total - last)
                    partial = true
                } else if let first = Int(parts[0]) {
                    start = max(0, first)
                    if !parts[1].isEmpty, let last = Int(parts[1]) { end = min(last, total - 1) }
                    partial = true
                }
            }
        }
        if !partial {
            start = 0
            end = max(0, total - 1)
        }
        guard start <= end else {
            var h = cors()
            h["Content-Range"] = "bytes */\(total)"
            send(conn, status: 416, reason: "Range Not Satisfiable", headers: h, body: Data())
            return
        }
        let length = end - start + 1
        headers["Content-Length"] = String(length)
        if partial {
            headers["Content-Range"] = "bytes \(start)-\(end)/\(total)"
        }
        let head: String
        if partial {
            head = "HTTP/1.1 206 Partial Content\r\n"
        } else {
            head = "HTTP/1.1 200 OK\r\n"
        }
        var out = Data(head.utf8)
        for (k, v) in headers { out.append(Data("\(k): \(v)\r\n".utf8)) }
        out.append(Data("Connection: close\r\n\r\n".utf8))

        guard let handle = try? FileHandle(forReadingFrom: url) else {
            send(conn, status: 404, reason: "Not Found", headers: cors(), body: Data())
            return
        }
        try? handle.seek(toOffset: UInt64(start))
        conn.send(content: out, completion: .contentProcessed { _ in
            var left = length
            func pump() {
                guard left > 0 else {
                    try? handle.close()
                    conn.cancel()
                    return
                }
                var chunk: Data?
                do { chunk = try handle.read(upToCount: min(65536, left)) } catch { chunk = nil }
                guard let data = chunk, !data.isEmpty else {
                    try? handle.close()
                    conn.cancel()
                    return
                }
                left -= data.count
                conn.send(content: data, completion: .contentProcessed { _ in pump() })
            }
            pump()
        })
    }

    // ---------- интернет через прокси ----------

    private func proxy(_ conn: NWConnection, _ req: Request) {
        guard let raw = req.query["u"], let url = URL(string: raw) else {
            send(conn, status: 400, reason: "Bad Request", headers: cors(), body: Data())
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = req.method
        request.timeoutInterval = 30
        for (k, v) in req.headers where k != "host" && k != "connection" && !k.hasPrefix("sec-") {
            request.setValue(v, forHTTPHeaderField: k)
        }
        if request.value(forHTTPHeaderField: "User-Agent") == nil {
            request.setValue(Net.userAgent, forHTTPHeaderField: "User-Agent")
        }
        let session = URLSession(configuration: .ephemeral, delegate: ProxySession(conn: conn, cors: cors()), delegateQueue: nil)
        let task = session.dataTask(with: request)
        task.resume()
        ProxySession.keepAlive.append(session)
    }
}

/// Потоковая передача ответа прокси: заголовки — сразу, тело — кусками.
private final class ProxySession: NSObject, URLSessionDataDelegate {
    /// Сессии держим живыми, пока идёт передача.
    static var keepAlive: [URLSession] = []

    private let conn: NWConnection
    private let cors: [String: String]

    init(conn: NWConnection, cors: [String: String]) {
        self.conn = conn
        self.cors = cors
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse else {
            completionHandler(.cancel)
            return
        }
        var headers = cors
        for (k, v) in http.allHeaderFields {
            let key = (k as? String) ?? ""
            let lower = key.lowercased()
            if lower == "content-length" || lower == "content-encoding" || lower == "transfer-encoding" || lower == "connection" { continue }
            headers[key] = "\(v)"
        }
        var head = "HTTP/1.1 \(http.statusCode) \(HTTPURLResponse.localizedString(forStatusCode: http.statusCode).capitalized)\r\n"
        for (k, v) in headers { head += "\(k): \(v)\r\n" }
        head += "Connection: close\r\n\r\n"
        conn.send(content: Data(head.utf8), completion: .contentProcessed { _ in })
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        conn.send(content: data, completion: .contentProcessed { _ in })
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        conn.cancel()
        session.finishTasksAndInvalidate()
        ProxySession.keepAlive.removeAll { $0 === session }
    }
}

/// Общий User-Agent: как на Android и на компьютере.
enum Net {
    static let userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
}
