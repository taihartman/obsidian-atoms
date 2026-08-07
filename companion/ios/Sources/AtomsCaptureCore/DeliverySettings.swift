import Foundation

/// Delivery mode + Shortcut name (shared App Group when available).
public final class DeliverySettings: @unchecked Sendable {
    public static let defaultShortcutName = "Atoms Capture Append"
    /// Built-in Capture Atom iCloud link (plugin ships updates; hub can open install).
    public static let captureAtomICloudURL =
        "https://www.icloud.com/shortcuts/bbd26339dc874a13b36b31620cf3c457"

    private let defaults: UserDefaults
    private let modeKey = "delivery_mode"
    private let shortcutNameKey = "shortcut_name"
    private let shortcutReadyKey = "shortcut_ready_ack"

    public init(defaults: UserDefaults? = nil, suiteName: String? = VaultStore.defaultSuiteName) {
        if let defaults {
            self.defaults = defaults
        } else if let suiteName, let suite = UserDefaults(suiteName: suiteName) {
            self.defaults = suite
        } else {
            self.defaults = .standard
        }
    }

    public var mode: DeliveryMode {
        get {
            if let raw = defaults.string(forKey: modeKey),
               let mode = DeliveryMode(rawValue: raw) {
                return mode
            }
            // Default: Sync path — most iPhone Atoms users.
            return .syncShortcut
        }
        set {
            defaults.set(newValue.rawValue, forKey: modeKey)
        }
    }

    public var shortcutName: String {
        get {
            let name = defaults.string(forKey: shortcutNameKey)?.trimmingCharacters(in: .whitespacesAndNewlines)
            if let name, !name.isEmpty { return name }
            return Self.defaultShortcutName
        }
        set {
            defaults.set(newValue, forKey: shortcutNameKey)
        }
    }

    public var shortcutReadyAcknowledged: Bool {
        get { defaults.bool(forKey: shortcutReadyKey) }
        set { defaults.set(newValue, forKey: shortcutReadyKey) }
    }
}
