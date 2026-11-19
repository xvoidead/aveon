import UIKit
import SwiftUI
import WebKit
import Capacitor

// Контроллер приложения: движок авеона (тот же плеер, что на компьютере) живёт в WebView,
// а нативный интерфейс нарисован поверх него SwiftUI. Как в Android-порте: звук, бочка и
// таймеры работают как обычно, а касания до движка не доходят — всё рисует SwiftUI.
//
// Полноэкранный режим (строка состояния и домашняя полоска) на iOS ведёт штатный плагин
// Capacitor SystemBars: переопределить prefersHomeIndicatorAutoHidden здесь нельзя —
// Capacitor перекрывает его в своём модуле, и SystemBars прячет обе полоски.
public class AveonViewController: CAPBridgeViewController {
    private var host: UIHostingController<AveonRootView>?
    private var proxy: BridgeProxy?

    /// Локальный сервер приложения поднимаем до загрузки страницы: движок и обложки
    /// приходят с него (см. LocalServer).
    public override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        LocalServer.shared.startAndWait()
        descriptor.serverURL = LocalServer.shared.origin
        return descriptor
    }

    /// Мост с движком ставим до загрузки страницы: скрипт должен попасть в документ
    /// раньше, чем выполнится renderer/native.js.
    public override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        configuration.userContentController.addUserScript(
            WKUserScript(source: AveonViewController.bridgeScript,
                         injectionTime: .atDocumentStart,
                         forMainFrameOnly: true)
        )
        return configuration
    }

    public override func capacitorDidLoad() {
        super.capacitorDidLoad()
        let handler = BridgeProxy(self)
        proxy = handler
        webView?.configuration.userContentController.add(handler, name: "aveon")
        bridge?.registerPluginInstance(AveonPlugin())
        if let web = webView { Engine.shared.attach(web) }
    }

    public override func viewDidLoad() {
        super.viewDidLoad()
        setupInterface()
    }

    // ---------- мост с движком ----------

    /// Тот же протокол, что у Android-порта: JS шлёт window.AveonUI.emit(type, json),
    /// нативная часть отвечает через window.AveonUI.reply(id, ok, json).
    static let bridgeScript = """
    (function () {
      if (window.AveonUI) return;
      var handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.aveon;
      if (!handler) return;
      window.AveonUI = {
        emit: function (type, json) { handler.postMessage({ kind: 'emit', a: type, b: json }); },
        reply: function (id, ok, json) { handler.postMessage({ kind: 'reply', a: id, b: ok ? 1 : 0, c: json }); }
      };
    })();
    """

    /// Сообщение от страницы движка.
    func handle(_ message: WKScriptMessage) {
        guard message.name == "aveon", let body = message.body as? [String: Any] else { return }
        switch body["kind"] as? String {
        case "emit":
            let type = body["a"] as? String ?? ""
            let json = body["b"] as? String ?? ""
            DispatchQueue.main.async { Engine.shared.handleEmit(type: type, json: json) }
        case "reply":
            let id = (body["a"] as? NSNumber)?.intValue ?? 0
            let ok = ((body["b"] as? NSNumber)?.intValue ?? 0) == 1
            let json = body["c"] as? String ?? "null"
            DispatchQueue.main.async { Engine.shared.handleReply(id: id, ok: ok, json: json) }
        default:
            break
        }
    }

    // ---------- нативный интерфейс ----------

    private func setupInterface() {
        let hosting = UIHostingController(rootView: AveonRootView())
        hosting.view.backgroundColor = .clear
        addChild(hosting)
        view.addSubview(hosting.view)
        hosting.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            hosting.view.topAnchor.constraint(equalTo: view.topAnchor),
            hosting.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            hosting.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            hosting.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        hosting.didMove(toParent: self)
        host = hosting
    }

    deinit {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "aveon")
        Engine.shared.detach()
    }
}

/// Приём сообщений от страницы — через слабую ссылку, чтобы не держать контроллер.
private final class BridgeProxy: NSObject, WKScriptMessageHandler {
    weak var owner: AveonViewController?

    init(_ owner: AveonViewController) {
        self.owner = owner
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.handle(message)
    }
}
