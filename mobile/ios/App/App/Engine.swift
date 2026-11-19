import Foundation
import SwiftUI
import WebKit

// Движок авеона — тот же плеер, что на компьютере (renderer/ + мост mobile/bridge), живёт в WebView
// под нативным экраном. Здесь его состояние и команды к нему (NativeUI.call в renderer/native.js).
// Как в Android-порте (Engine.kt): JS шлёт события через window.AveonUI.emit, нативная часть
// отвечает на команды и получает ответ через window.NativeUI.reply.
//
// Класс намеренно не изолирован по актору: SwiftUI читает состояние прямо из тела вью, и
// изоляция сломала бы обращение к Engine.shared. Всё изменяемое состояние трогается только
// на главном потоке — вход из контроллера приходит через DispatchQueue.main, а ожидание
// ответа движка — через MainActor.run.
final class Engine: ObservableObject {
    static let shared = Engine()

    // ---------- состояние из движка ----------
    @Published var ready = false
    @Published var player = PlayerState()
    @Published var theme: [String: String] = [:]
    @Published var account = AccountState()
    @Published var stats = StatsState()
    @Published var library = LibraryState()
    @Published var panels: [PanelState] = []
    @Published var menu: MenuState? = nil
    @Published var ask: AskState? = nil
    @Published var toasts: [ToastState] = []
    @Published var spectrum: [Float] = []
    @Published var reactions: [Reaction] = []
    @Published var visualizerOpen = false
    @Published var wrapped: WrappedState? = nil
    @Published var homeVersion = 0        // «домашний» экран обновился
    @Published var openRequest: String? = nil

    struct Reaction: Identifiable, Hashable {
        var id = UUID()
        var e: String = ""
        var who: String = ""
    }

    private weak var webView: WKWebView?
    private var seq = 0
    private var waiters: [Int: CheckedContinuation<Any?, Error>] = [:]
    private var toastSeq = 0

    enum EngineError: LocalizedError {
        case noWeb
        case timeout
        case failed(String)

        var errorDescription: String? {
            switch self {
            case .noWeb: return "Движок не готов"
            case .timeout: return "Движок не ответил"
            case .failed(let m): return m
            }
        }
    }

    func attach(_ web: WKWebView) {
        webView = web
    }

    func detach() {
        webView = nil
        ready = false
        for (_, c) in waiters { c.resume(throwing: EngineError.noWeb) }
        waiters.removeAll()
    }

    // ---------- из движка ----------

    /// Событие движка. Вызывается с главного потока.
    func handleEmit(type: String, json: String) {
        let value = Engine.parse(json)
        switch type {
        case "ready":
            ready = true
        case "player":
            if let o = value as? JObj { player = PlayerState(o) }
        case "theme":
            if let o = value as? JObj {
                var t: [String: String] = [:]
                for (k, v) in o { if let s = v as? String { t[k] = s } }
                theme = t
            }
        case "account":
            if let o = value as? JObj { account = AccountState(o) }
        case "stats":
            if let o = value as? JObj { stats = StatsState(o) }
        case "library":
            if let o = value as? JObj { library = LibraryState(o) }
        case "panel":
            if let o = value as? JObj {
                let p = PanelState(o)
                if let i = panels.firstIndex(where: { $0.key == p.key }) {
                    panels[i] = p
                } else {
                    panels.append(p)
                }
            }
        case "panelClose":
            if let key = value as? String {
                panels.removeAll { $0.key == key }
            }
        case "menu":
            if let o = value as? JObj { menu = MenuState(o) }
        case "menuClose":
            menu = nil
        case "ask":
            if let o = value as? JObj { ask = AskState(o) }
        case "toast":
            if let o = value as? JObj {
                pushToast(o.str("msg"), err: o.str("kind") == "err", life: o.str("kind") == "err" ? 5.2 : 3.2)
            }
        case "spec":
            if let s = value as? String {
                spectrum = s.split(separator: ",").compactMap { Float($0.trimmingCharacters(in: .whitespaces)) }.map { $0 / 255 }
            }
        case "open":
            if let o = value as? JObj {
                switch o.str("k") {
                case "visualizer": visualizerOpen = true
                case "wrapped":
                    if let d = o.obj("data") { wrapped = WrappedState(d) }
                default: break
                }
            }
        case "homeChanged":
            homeVersion += 1
        case "react":
            if let o = value as? JObj {
                let r = Reaction(e: o.str("e"), who: o.str("who"))
                reactions.append(r)
                if reactions.count > 24 { reactions.removeFirst() }
                Task { @MainActor [weak self] in
                    try? await Task.sleep(nanoseconds: 2_500_000_000)
                    self?.reactions.removeAll { $0.id == r.id }
                }
            }
        default:
            break
        }
    }

    /// Ответ движка на команду. Вызывается с главного потока.
    func handleReply(id: Int, ok: Bool, json: String) {
        guard let cont = waiters.removeValue(forKey: id) else { return }
        let value = Engine.parse(json)
        if ok {
            cont.resume(returning: value)
        } else {
            cont.resume(throwing: EngineError.failed((value as? String) ?? "ошибка"))
        }
    }

    // ---------- в движок ----------

    /// Команда движку с ответом.
    func call(_ name: String, _ args: [Any] = []) async throws -> Any? {
        guard let web = webView else { throw EngineError.noWeb }
        if !ready {
            for _ in 0..<300 {
                if ready { break }
                try? await Task.sleep(nanoseconds: 100_000_000)
            }
        }
        let id = await MainActor.run { () -> Int in
            self.seq += 1
            return self.seq
        }
        let argsJson = Engine.jsonString(args)
        let js = "window.NativeUI&&NativeUI.call(\(id),\(Engine.jsonString(name)),\(Engine.jsonString(argsJson)))"
        return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Any?, Error>) in
            Task { @MainActor in
                self.waiters[id] = cont
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 30_000_000_000)
                    guard let c = self.waiters.removeValue(forKey: id) else { return }
                    c.resume(throwing: EngineError.timeout)
                }
                web.evaluateJavaScript(js) { _, error in
                    if let error {
                        Task { @MainActor in
                            guard let c = self.waiters.removeValue(forKey: id) else { return }
                            c.resume(throwing: EngineError.failed(error.localizedDescription))
                        }
                    }
                }
            }
        }
    }

    /// Команда без ответа: ошибку покажем сами.
    func send(_ name: String, _ args: [Any] = []) {
        Task { @MainActor in
            do {
                _ = try await self.call(name, args)
            } catch {
                self.pushToast(error.localizedDescription, err: true, life: 5.2)
            }
        }
    }

    /// Команда с ответом-объектом (для экранов, которые сами просят данные у движка).
    func obj(_ name: String, _ args: [Any] = []) async -> JObj? {
        do {
            return try await call(name, args) as? JObj
        } catch {
            pushToast(error.localizedDescription, err: true, life: 5.2)
            return nil
        }
    }

    /// Команда со списком на ответ.
    func list(_ name: String, _ args: [Any] = []) async -> [JObj] {
        // call() отдаёт Any? — try? схлопывает вложенный optional, поэтому
        // «ошибка» и «пустой ответ» приходят одинаково: пустым списком.
        guard let value = try? await call(name, args) else { return [] }
        return (value as? [JObj]) ?? []
    }

    func toast(_ msg: String, err: Bool = false) {
        pushToast(msg, err: err, life: err ? 5.2 : 3.2)
    }

    /// Плашка уведомления: показывается сверху и сама исчезает.
    private func pushToast(_ msg: String, err: Bool, life: Double) {
        Task { @MainActor in
            self.toastSeq += 1
            let t = ToastState(id: self.toastSeq, msg: msg, err: err)
            self.toasts.append(t)
            if self.toasts.count > 3 { self.toasts.removeFirst(self.toasts.count - 3) }
            try? await Task.sleep(nanoseconds: UInt64(life * 1_000_000_000))
            self.toasts.removeAll { $0.id == t.id }
        }
    }

    // ---------- разбор JSON ----------

    static func parse(_ json: String) -> Any? {
        guard let data = json.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    }

    static func jsonString(_ value: Any) -> String {
        if let s = value as? String { return encode(s) }
        if let d = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]) {
            return String(data: d, encoding: .utf8) ?? "null"
        }
        return "null"
    }

    static func encode(_ s: String) -> String {
        if let d = try? JSONSerialization.data(withJSONObject: [s], options: []) {
            let arr = String(data: d, encoding: .utf8) ?? "[]"
            return String(arr.dropFirst().dropLast())
        }
        return "\"\""
    }
}
