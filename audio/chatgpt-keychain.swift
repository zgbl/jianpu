import Foundation
import Security

let args = CommandLine.arguments
guard args.count == 4 else { exit(2) }
let operation = args[1]
let service = args[2]
let account = args[3]
let base: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: account
]

func report(_ status: OSStatus) -> Never {
    if status == errSecSuccess { print("ok"); exit(0) }
    fputs("Keychain operation failed (\(status))\n", stderr)
    exit(1)
}

switch operation {
case "get":
    var query = base
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound { exit(3) }
    guard status == errSecSuccess, let data = item as? Data else { report(status) }
    print(data.base64EncodedString())
case "set":
    guard let line = readLine(), let data = Data(base64Encoded: line), data.count == 32 else { exit(2) }
    // Use the default macOS keychain. Data-protection keychain access requires
    // an app entitlement, which a locally run Node development server lacks.
    let attributes: [String: Any] = [kSecValueData as String: data]
    let status = SecItemUpdate(base as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
        var item = base
        item.merge(attributes) { _, new in new }
        report(SecItemAdd(item as CFDictionary, nil))
    } else { report(status) }
case "delete":
    let status = SecItemDelete(base as CFDictionary)
    if status == errSecItemNotFound { exit(0) }
    report(status)
default:
    exit(2)
}
