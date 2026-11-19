import Foundation
import AVFoundation

// «В звонке» на iOS: система не отдаёт приложению чужих голосов, но мы видим,
// что прервали звук (позвонили) или что включился микрофон (запись разговора, Discord).
// Плюс ручная кнопка «в бочку» — как на Android.
final class CallMonitor {
    static let shared = CallMonitor()

    private(set) var inCall = false
    /// Ручной режим: пользователь сам включил бочку.
    var manual = false

    private var observers: [NSObjectProtocol] = []

    func start() {
        guard observers.isEmpty else { return }
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            guard let info = note.userInfo,
                  let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            switch type {
            case .began: self?.set(true)
            case .ended: self?.set(false)
            @unknown default: break
            }
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.checkRoute()
        })
        checkRoute()
    }

    func stop() {
        for o in observers { NotificationCenter.default.removeObserver(o) }
        observers.removeAll()
    }

    /// Телефонный разговор: маршрут ушёл на «динамик/наушник» — значит нас слушают.
    private func checkRoute() {
        let session = AVAudioSession.sharedInstance()
        if session.category == .playAndRecord || session.category == .record {
            set(true)
            return
        }
        let outputs = session.currentRoute.outputs
        let phone = outputs.contains { out in
            out.portType == .builtInReceiver || out.portType == .builtInSpeaker
        }
        let recording = outputs.contains { $0.portName.lowercased().contains("микрофон") }
        if recording { set(true) }
        _ = phone
    }

    func set(_ value: Bool) {
        if inCall == value { return }
        inCall = value
    }

    var state: [String: Any] {
        ["call": inCall, "discord": false]
    }
}
