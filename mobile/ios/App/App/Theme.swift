import SwiftUI
import UIKit

// Палитра приходит из движка: те же переменные, что красят плеер на компьютере — обложка
// (палитра трека), тема и акцент из «Оформления». Поэтому телефон меняется вместе с настройками.
struct Pal: Equatable {
    var bg: Color = Color(hex: 0x1B1411)
    var surface: Color = Color(hex: 0x231A16)
    var soft: Color = Color(hex: 0x2A201B)
    var line: Color = Color(hex: 0x3A2D26)
    var hoop: Color = Color(hex: 0x5A4636)
    var text: Color = Color(hex: 0xF4E9DC)
    var text2: Color = Color(hex: 0xBFAE99)
    var text3: Color = Color(hex: 0x8A7A68)
    var accent: Color = Color(hex: 0xF0A63A)
    var voice: Color = Color(hex: 0x9AA8FF)
    var danger: Color = Color(hex: 0xFF7A6B)

    var onAccent: Color { accent.luminance > 0.45 ? bg : .white }
    var onVoice: Color { voice.luminance > 0.45 ? Color(hex: 0x14122A) : .white }

    /// Интерфейс iOS: чёрный фон, серые плашки (как в Apple Music).
    static let apple = Pal(
        bg: Color(hex: 0x000000),
        surface: Color(hex: 0x1C1C1E),
        soft: Color(hex: 0x2C2C2E),
        line: Color(hex: 0x38383A),
        hoop: Color(hex: 0x48484A),
        text: Color(hex: 0xFFFFFF),
        text2: Color(hex: 0x99EBEBF5),
        text3: Color(hex: 0x66EBEBF5),
        accent: Color(hex: 0xFA2D48),
        voice: Color(hex: 0x9AA8FF),
        danger: Color(hex: 0xFF453A)
    )

    /// Палитра трека из движка — фон плеера, визуализатор, итоги года.
    static func of(_ m: [String: String]) -> Pal {
        let d = Pal()
        func c(_ k: String, _ def: Color) -> Color {
            // alphaValue, а не opacity: в Color.opacity — метод, а не свойство.
            guard let raw = m[k], let col = Color(css: raw), col.alphaValue > 0.05 else { return def }
            return col
        }
        var p = Pal()
        p.bg = c("oak", d.bg)
        p.surface = c("oak-2", d.surface)
        p.soft = c("rivet", d.soft)
        p.line = c("rivet-2", d.line)
        p.hoop = c("hoop", d.hoop)
        p.text = c("text", d.text)
        p.text2 = c("text-2", d.text2)
        p.text3 = c("text-3", d.text3)
        p.accent = c("amber", d.accent)
        p.voice = c("voice", d.voice)
        p.danger = c("danger", d.danger)
        return p
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: 1)
    }

    /// rgb(), rgba() и color(srgb …) из getComputedStyle.
    init?(css: String) {
        let v = css.trimmingCharacters(in: .whitespacesAndNewlines)
        if v.hasPrefix("#") {
            let hex = String(v.dropFirst())
            if hex.count == 6, let n = UInt32(hex, radix: 16) {
                self.init(hex: n)
                return
            }
            if hex.count == 3 {
                let s = hex.map { "\($0)\($0)" }.joined()
                if let n = UInt32(s, radix: 16) {
                    self.init(hex: n)
                    return
                }
            }
            return nil
        }
        let nums = v.replacingOccurrences(of: "rgba(", with: "")
            .replacingOccurrences(of: "rgb(", with: "")
            .replacingOccurrences(of: "color(srgb", with: "")
            .replacingOccurrences(of: ")", with: "")
            .replacingOccurrences(of: "/", with: " ")
            .split(separator: " ")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        guard nums.count >= 3 else { return nil }
        let vals = nums.prefix(3).compactMap { part -> Double? in
            if part.hasSuffix("%") { return Double(part.dropLast()) ?? nil }
            return Double(part)
        }
        guard vals.count == 3 else { return nil }
        let scale = v.contains("color(srgb") ? 1.0 : 255.0
        var alpha = 1.0
        if nums.count > 3 {
            let a = nums[3]
            alpha = a.hasSuffix("%") ? (Double(a.dropLast()) ?? 100) / 100 : (Double(a) ?? 1)
        }
        self.init(.sRGB, red: vals[0] / scale, green: vals[1] / scale, blue: vals[2] / scale, opacity: min(max(alpha, 0), 1))
    }

    var luminance: Double {
        let c = UIColor(self)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        c.getRed(&r, green: &g, blue: &b, alpha: &a)
        return 0.2126 * Double(r) + 0.7152 * Double(g) + 0.0722 * Double(b)
    }

    /// Прозрачность цвета: палитра из движка может прийти почти прозрачной.
    var alphaValue: Double {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        guard UIColor(self).getRed(&r, green: &g, blue: &b, alpha: &a) else { return 1 }
        return Double(a)
    }

    /// Смешивание с другим цветом: k = 0 — этот цвет, k = 1 — другой.
    func mix(_ other: Color, _ k: Double) -> Color {
        let t = min(max(k, 0), 1)
        let a = UIColor(self), b = UIColor(other)
        var ar: CGFloat = 0, ag: CGFloat = 0, ab: CGFloat = 0, aa: CGFloat = 0
        var br: CGFloat = 0, bg: CGFloat = 0, bb: CGFloat = 0, ba: CGFloat = 0
        a.getRed(&ar, green: &ag, blue: &ab, alpha: &aa)
        b.getRed(&br, green: &bg, blue: &bb, alpha: &ba)
        return Color(.sRGB, red: Double(ar + (br - ar) * t), green: Double(ag + (bg - ag) * t), blue: Double(ab + (bb - ab) * t), opacity: Double(aa + (ba - aa) * t))
    }
}

// Шрифты: системный SF Pro — как на iOS. Размеры — по шкале Apple.
enum T {
    static func display(_ size: CGFloat, _ weight: Font.Weight = .bold, track: CGFloat = -0.6) -> Font {
        .system(size: size, weight: weight, design: .rounded).monospacedDigit()
    }

    static let large = Font.system(size: 32, weight: .bold)
    static let title1 = Font.system(size: 26, weight: .bold)
    static let title2 = Font.system(size: 21, weight: .bold)
    static let title3 = Font.system(size: 19, weight: .semibold)
    static let headline = Font.system(size: 17, weight: .semibold)
    static let body = Font.system(size: 17)
    static let callout = Font.system(size: 16)
    static let subhead = Font.system(size: 15)
    static let subheadM = Font.system(size: 15, weight: .medium)
    static let footnote = Font.system(size: 13)
    static let footnoteM = Font.system(size: 13, weight: .semibold)
    static let caption = Font.system(size: 12)
    static let tab = Font.system(size: 10, weight: .semibold)
    static let lyric = Font.system(size: 27, weight: .bold)
}
