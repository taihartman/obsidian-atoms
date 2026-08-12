import Foundation

/// Sync delivery uses **Capture Atom** (mobile-install.json SSOT).
public final class DeliverySettings: @unchecked Sendable {
    /// mobile-install.json → captureAtom.name
    public static let captureAtomName = "Capture Atom"

    /// mobile-install.json → captureAtom.urls[0]
    public static let captureAtomICloudURL =
        "https://www.icloud.com/shortcuts/d6ee1009562c4a9a9694f36a5f0c0187"

    private let defaults: UserDefaults
    private let modeKey = "delivery_mode"
    private let shortcutReadyKey = "capture_atom_ready_ack"

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

    public var shortcutName: String { Self.captureAtomName }

    public var hasInstallURL: Bool {
        Self.captureAtomICloudURL.hasPrefix("https://www.icloud.com/shortcuts/")
    }

    public var shortcutReadyAcknowledged: Bool {
        get { defaults.bool(forKey: shortcutReadyKey) }
        set { defaults.set(newValue, forKey: shortcutReadyKey) }
    }

    // Back-compat names used by older call sites
    public static var appendShortcutName: String { captureAtomName }
    public static var appendShortcutICloudURL: String { captureAtomICloudURL }
}
