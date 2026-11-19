#!/usr/bin/env python3
"""Статическая проверка символов Swift-файлов: компилятора в песочнице нет, поэтому ищем
опечатки в именах — свои типы и их члены, обращения к Engine/Nav."""
import re
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1] / "App" / "App"

# Члены, которые приходят из протоколов SwiftUI/Foundation или синтезируются компилятором.
INHERITED = {
    "body", "id", "init", "self", "Type", "none", "default", "Error", "allCases",
    "rawValue", "hashValue", "description", "debugDescription", "count", "first", "last",
    "isEmpty", "map", "filter", "contains", "append", "removeAll", "removeValue", "insert",
    "some", "none", "self", "Type",
}

DECL = re.compile(
    r"^(?:@[\w:()., ]+\s+)*"
    r"(?:public\s+|internal\s+|private\s+|fileprivate\s+|open\s+|final\s+)*"
    r"(struct|class|enum|protocol|actor|typealias)\s+([A-Z][A-Za-z0-9_]*)"
)
EXT = re.compile(
    r"^(?:@[\w:()., ]+\s+)*"
    r"(?:public\s+|internal\s+|private\s+|fileprivate\s+|open\s+|final\s+)*"
    r"extension\s+([A-Z][A-Za-z0-9_]*)"
)
MEMBER = re.compile(
    r"^(?:@\w+\s+)*(?:public\s+|internal\s+|private\s+|fileprivate\s+|open\s+|final\s+|static\s+|"
    r"class\s+|override\s+|mutating\s+|nonisolated\s+|lazy\s+|weak\s+|unowned\s+|@MainActor\s+)*"
    r"(?:var|let|func)\s+([A-Za-z_][A-Za-z0-9_]*)"
)
CASE = re.compile(r"^case\s+([A-Za-z_][A-Za-z0-9_]*)")


def strip_comments(text: str) -> str:
    out = []
    i, n = 0, len(text)
    while i < n:
        if text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
            continue
        if text.startswith("/*", i):
            depth, i = 1, i + 2
            while i < n and depth:
                if text.startswith("/*", i):
                    depth += 1
                    i += 2
                elif text.startswith("*/", i):
                    depth -= 1
                    i += 2
                else:
                    i += 1
            continue
        out.append(text[i])
        i += 1
    return "".join(out)


def collect() -> tuple[dict[str, set[str]], dict[str, str], set[str]]:
    """Типы приложения -> члены; имя файла -> текст; типы, объявленные в приложении."""
    members: dict[str, set[str]] = {}
    files: dict[str, str] = {}
    own: set[str] = set()
    for path in sorted(ROOT.glob("*.swift")):
        text = strip_comments(path.read_text(encoding="utf-8"))
        files[path.name] = text
        stack: list[tuple[str, int]] = []   # (имя типа, глубина на входе)
        depth = 0
        for line in text.splitlines():
            stripped = line.strip()
            m = DECL.match(stripped)
            if m:
                own.add(m.group(2))
                members.setdefault(m.group(2), set())
                stack.append((m.group(2), depth))
            elif EXT.match(stripped):
                # расширение чужого типа (Color, JObj…) — его члены не проверяем
                stack.append((None, depth))  # type: ignore[arg-type]
            # члены — на уровне текущего типа
            if stack and stack[-1][0]:
                mm = MEMBER.match(stripped)
                if mm:
                    members[stack[-1][0]].add(mm.group(1))
                mc = CASE.match(stripped)
                if mc:
                    members[stack[-1][0]].add(mc.group(1))
            depth += line.count("{") - line.count("}")
            while stack and depth <= stack[-1][1]:
                stack.pop()
    return members, files, own


def main() -> int:
    members, files, own = collect()
    problems: list[str] = []

    use = re.compile(r"\b([A-Z][A-Za-z0-9_]*)\.([a-z_][A-Za-z0-9_]*)")
    for name, text in files.items():
        for m in use.finditer(text):
            typ, member = m.group(1), m.group(2)
            if typ not in own:
                continue
            if member in INHERITED or member in members[typ]:
                continue
            problems.append(f"{name}: {typ}.{member} — такого члена нет")

    for name, text in files.items():
        for m in re.finditer(r"\bengine\.([a-zA-Z_][A-Za-z0-9_]*)", text):
            member = m.group(1)
            if member not in members.get("Engine", set()):
                problems.append(f"{name}: engine.{member} — такого метода у Engine нет")
        for m in re.finditer(r"\bnav\.([a-zA-Z_][A-Za-z0-9_]*)", text):
            member = m.group(1)
            if member not in members.get("Nav", set()):
                problems.append(f"{name}: nav.{member} — такого члена у Nav нет")

    # 3. Типы в объявлениях: свои или известные из SDK
    sdk = {
        # SwiftUI
        "View", "Text", "Image", "Button", "Toggle", "Slider", "Menu", "TextField", "SecureField",
        "ScrollView", "LazyVStack", "LazyVGrid", "VStack", "HStack", "ZStack", "Group", "ScrollViewReader",
        "ScrollViewReader", "ForEach", "NavigationStack", "NavigationLink", "List", "Section", "Divider",
        "Spacer", "ProgressView", "Label", "Shape", "Circle", "RoundedRectangle", "Rectangle", "Capsule",
        "LinearGradient", "Color", "Font", "Binding", "ObservableObject", "PublishedObject", "StateObject",
        "ObservedObject", "State", "Environment", "EnvironmentObject", "ViewBuilder", "GeometryReader",
        "ScrollView", "ToolbarItem", "ToolbarItemPlacement", "Alert", "AnyView", "EmptyView", "Never",
        "Identifiable", "Hashable", "Equatable", "Codable", "Sendable", "Decodable", "Encodable",
        "LocalizedStringKey", "StringProtocol", "ShapeStyle", "Animation", "Transaction", "Namespace",
        "Gesture", "DragGesture", "TapGesture", "MagnificationGesture", "AnyGesture", "ScrollView",
        "Canvas", "TimelineView", "Gauge", "ShareLink", "TextEditor", "Picker", "DatePicker", "ColorPicker",
        "Stepper", "Form", "EditButton", "Widget", "DisclosureGroup", "OutlineGroup", "Table",
        # Foundation / stdlib
        "String", "Int", "Double", "Bool", "Float", "Data", "Date", "URL", "UUID", "Error", "Array",
        "Dictionary", "Set", "Optional", "Result", "Any", "AnyObject", "Void", "Character", "Substring",
        "Range", "ClosedRange", "NSNumber", "NSNull", "NSObject", "NSString", "NSData", "NSError",
        "Notification", "NotificationCenter", "URLSession", "URLRequest", "URLResponse", "HTTPURLResponse",
        "FileManager", "FileHandle", "Bundle", "ProcessInfo", "Timer", "Thread", "DispatchQueue",
        "DispatchSemaphore", "JSONSerialization", "JSONDecoder", "JSONEncoder", "Locale", "Calendar",
        "DateFormatter", "ISO8601DateFormatter", "TimeInterval", "Task", "MainActor", "Actor",
        "IndexPath", "Set", "Zip2Sequence", "Sequence", "Collection", "Comparable", "CustomStringConvertible",
        "Comparable", "LosslessStringConvertible", "CaseIterable", "RawRepresentable", "ExpressibleBy",
        # UIKit / Foundation на iOS
        "UIImage", "UIColor", "UIFont", "UIView", "UIScreen", "UIDevice", "UIApplication", "UIWindow",
        "UIBezierPath", "UIGraphics", "UIViewController", "UIHostingController", "UIUserInterfaceStyle",
        "UIScene", "UISceneSession", "UISceneConfiguration", "UIWindowScene", "UIStoryboard",
        "UIPasteboard", "UIDocumentPickerViewController", "UTType", "UniformTypeIdentifiers",
        # AVFoundation / MediaPlayer / WebKit / Security / CryptoKit / Network / PhotosUI
        "AVAudioSession", "AVAudioSessionInterruptionType", "AVAsset", "AVURLAsset", "AVMetadataItem",
        "AVSpeechSynthesizer", "AVSpeechUtterance", "AVSpeechSynthesisVoice", "MPMediaItem",
        "MPNowPlayingInfoCenter", "MPNowPlayingInfoProperty", "MPRemoteCommandCenter", "MPChangePlaybackPosition",
        "WKWebView", "WKWebViewConfiguration", "WKUserScript", "WKUserContentController", "WKScriptMessage",
        "WKScriptMessageHandler", "WKWebpagePreferences", "SecItemCopyMatching", "SecItemAdd",
        "SecItemUpdate", "SymmetricKey", "AES", "NWListener", "NWConnection", "NWParameters",
        "NWEndpoint", "PHPickerViewController", "PHPickerConfiguration", "PHPickerResult",
        "NSItemProvider", "NSURL", "NSObjectProtocol", "NSLayoutConstraint", "UInt", "UInt16",
        "UInt64", "UInt8", "Int8", "Int16", "Int32", "Int64", "CGFloat", "CFDictionary", "CFTypeRef",
        "DispatchGroup", "DispatchQueue", "GridItem", "ViewModifier", "LocalizedError",
        "CheckedContinuation", "CharacterSet", "URLSessionDataTask", "URLSessionTask",
        "URLSessionDataDelegate", "UIDocumentPickerDelegate", "PHPickerViewControllerDelegate",
        "MPMediaItemArtwork", "MPChangePlaybackPositionCommandEvent", "MPNowPlayingInfoMediaType",
        "AVAudioSessionInterruptionTypeKey", "MPMediaItemPropertyTitle", "MPMediaItemPropertyArtist",
        "MPMediaItemPropertyAlbumTitle", "MPMediaItemPropertyPlaybackDuration",
        "MPNowPlayingInfoPropertyElapsedPlaybackTime", "MPNowPlayingInfoPropertyPlaybackRate",
        "MPNowPlayingInfoPropertyMediaType", "MPMediaItemPropertyArtwork",
        # Capacitor
        "CAPPlugin", "CAPPluginCall", "CAPPluginMethod", "CAPBridgedPlugin", "CAPBridgeProtocol",
        "CAPBridgeViewController", "CAPPluginReturnPromise", "CAPPluginReturnCallback",
        "CAPPluginReturnNone", "InstanceDescriptor", "InstanceConfiguration", "JSObject", "JSValue",
        "JSArray", "PluginCallResultData", "PluginCallResult", "CAPPluginCallResult", "CAPPluginCallError",
        "SceneDelegateProxy", "ApplicationDelegateProxy", "NotificationName",
    }
    type_positions = [
        re.compile(r"^\s*(?:@\w+\s+)*(?:public\s+|internal\s+|private\s+|fileprivate\s+|open\s+|static\s+|"
                   r"override\s+|final\s+|lazy\s+|weak\s+)*(?:var|let)\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*([A-Z][A-Za-z0-9_]*)"),
        re.compile(r"->\s*([A-Z][A-Za-z0-9_]*)"),
        re.compile(r"\bas[?!]?\s+([A-Z][A-Za-z0-9_]*)"),
        re.compile(r"\[([A-Z][A-Za-z0-9_]*)\]"),
    ]
    for name, text in files.items():
        for rx in type_positions:
            for m in rx.finditer(text):
                typ = m.group(1)
                if typ in own or typ in sdk or typ in INHERITED:
                    continue
                problems.append(f"{name}: тип «{typ}» — нет ни в приложении, ни в списке SDK")

    print(f"своих типов: {len(own)}")
    seen = []
    for p in problems:
        if p not in seen:
            seen.append(p)
            print(p)
    print("проблем:", len(seen))
    return 1 if seen else 0


if __name__ == "__main__":
    sys.exit(main())
