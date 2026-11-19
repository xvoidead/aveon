import Foundation
import CryptoKit
import Security

// Шифрование данных приложения ключом из связки ключей (как DPAPI в Windows-версии и
// Android Keystore в android-порте): настройки с токенами, альбомы, статистика.
// Ключ не покидает устройство.
enum Vault {
    private static let service = "com.aveon.player.vault"
    private static let account = "aveon-data"
    private static let prefix = "AV1:"

    enum VaultError: LocalizedError {
        case keychain(OSStatus)
        case badData

        var errorDescription: String? {
            switch self {
            case .keychain(let s): return "Связка ключей: \(s)"
            case .badData: return "Данные повреждены"
            }
        }
    }

    static func seal(_ text: String) throws -> String {
        let box = try AES.GCM.seal(Data(text.utf8), using: try loadKey())
        guard let combined = box.combined else { throw VaultError.badData }
        return prefix + combined.base64EncodedString()
    }

    static func open(_ stored: String) throws -> String {
        guard stored.hasPrefix(prefix) else { return stored }
        let data = Data(base64Encoded: String(stored.dropFirst(prefix.count))) ?? Data()
        let box = try AES.GCM.SealedBox(combined: data)
        let plain = try AES.GCM.open(box, using: try loadKey())
        return String(data: plain, encoding: .utf8) ?? ""
    }

    private static func loadKey() throws -> SymmetricKey {
        if let data = readKeychain() { return SymmetricKey(data: data) }
        let key = SymmetricKey(size: .bits256)
        let data = key.withUnsafeBytes { Data($0) }
        try writeKeychain(data)
        return key
    }

    private static func readKeychain() -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else { return nil }
        return item as? Data
    }

    private static func writeKeychain(_ data: Data) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        if status == errSecDuplicateItem {
            var match: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: account,
            ]
            let upd: [String: Any] = [kSecValueData as String: data]
            let st = SecItemUpdate(match as CFDictionary, upd as CFDictionary)
            guard st == errSecSuccess else { throw VaultError.keychain(st) }
        } else if status != errSecSuccess {
            throw VaultError.keychain(status)
        }
    }
}
