import Foundation

/// Sync delivery uses one slim iCloud shortcut (append only). Companion owns type/voice.
public final class DeliverySettings: @unchecked Sendable {
    /// Must match mobile-install.json → atomsCaptureAppend.name
    public static let appendShortcutName = "Atoms Capture Append"

    /// Must match mobile-install.json → atomsCaptureAppend.urls[0] (SSOT in repo root).
    public static let appendShortcutICloudURL =
        "https://www.icloud.com/shortcuts/9f7425ab9eb94884b610667a69a8e38b"

    private let defaults: UserDefaults
    private let modeKey = "delivery_mode"
    private let shortcutReadyKey = "append_shortcut_ready_ack"

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
            return .syncShortcut
        }
        set { defaults.set(newValue.rawValue, forKey: modeKey) }
    }

    public var shortcutName: String { Self.appendShortcutName }

    public var hasInstallURL: Bool {
        Self.appendShortcutICloudURL.hasPrefix("https://www.icloud.com/shortcuts/")
    }

    public var shortcutReadyAcknowledged: Bool {
        get { defaults.bool(forKey: shortcutReadyKey) }
        set { defaults.set(newValue, forKey: shortcutReadyKey) }
    }
}
