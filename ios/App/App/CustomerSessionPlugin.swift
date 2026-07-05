import Foundation
import Capacitor
import Security

@objc(CustomerSessionPlugin)
public class CustomerSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CustomerSessionPlugin"
    public let jsName = "CustomerSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]

    private let serviceName = "com.ironwaves.loyalty.customer-session"

    @objc func get(_ call: CAPPluginCall) {
        let key = call.getString("key") ?? ""
        guard !key.isEmpty else {
            call.reject("Key is required")
            return
        }

        do {
            let value = try readValue(for: key)
            call.resolve([
                "value": value as Any
            ])
        } catch {
            call.reject("Keychain read failed")
        }
    }

    @objc func set(_ call: CAPPluginCall) {
        let key = call.getString("key") ?? ""
        let value = call.getString("value") ?? ""
        guard !key.isEmpty else {
            call.reject("Key is required")
            return
        }

        do {
            try writeValue(value, for: key)
            call.resolve()
        } catch {
            call.reject("Keychain write failed")
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        let key = call.getString("key") ?? ""
        guard !key.isEmpty else {
            call.reject("Key is required")
            return
        }

        do {
            try deleteValue(for: key)
            call.resolve()
        } catch {
            call.reject("Keychain delete failed")
        }
    }

    private func baseQuery(for key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key
        ]
    }

    private func readValue(for key: String) throws -> String? {
        var query = baseQuery(for: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
        guard
            let data = item as? Data,
            let value = String(data: data, encoding: .utf8)
        else {
            return nil
        }
        return value
    }

    private func writeValue(_ value: String, for key: String) throws {
        let data = Data(value.utf8)
        var query = baseQuery(for: key)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]

        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecItemNotFound {
            query.merge(attributes) { _, new in new }
            let addStatus = SecItemAdd(query as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw NSError(domain: NSOSStatusErrorDomain, code: Int(addStatus))
            }
            return
        }

        guard updateStatus == errSecSuccess else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(updateStatus))
        }
    }

    private func deleteValue(for key: String) throws {
        let status = SecItemDelete(baseQuery(for: key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
    }
}
