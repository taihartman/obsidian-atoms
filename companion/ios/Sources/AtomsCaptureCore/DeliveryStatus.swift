import Foundation

/// Honest post-save status.
public enum DeliveryStatus: Equatable, Sendable {
    /// Appended via Files security-scoped bookmark.
    case inVault
    /// Formatted line handed to the Sync Shortcut (Obsidian bookmark path).
    case handedToShortcut
    case failed(reason: String)

    public var label: String {
        switch self {
        case .inVault:
            return "In vault"
        case .handedToShortcut:
            return "Handed to Shortcut"
        case .failed:
            return "Failed"
        }
    }

    public var detail: String? {
        switch self {
        case .inVault, .handedToShortcut:
            return nil
        case .failed(let reason):
            return reason
        }
    }

    public var isSuccess: Bool {
        switch self {
        case .inVault, .handedToShortcut:
            return true
        case .failed:
            return false
        }
    }
}

/// How captures leave the companion.
public enum DeliveryMode: String, CaseIterable, Codable, Sendable {
    /// Obsidian Sync Remote Vault via one-time Append Shortcut (default).
    case syncShortcut = "sync_shortcut"
    /// Files-visible vault folder (bookmark).
    case files = "files"
    /// Try Files when linked, else Shortcut.
    case auto = "auto"

    public var title: String {
        switch self {
        case .syncShortcut:
            return "Obsidian Sync (Shortcut)"
        case .files:
            return "Files folder"
        case .auto:
            return "Auto (Files if linked, else Shortcut)"
        }
    }

    public var blurb: String {
        switch self {
        case .syncShortcut:
            return "Best for Sync Remote Vault. One-time slim Shortcut appends into Obsidian; the companion owns type/voice/widget."
        case .files:
            return "Writes directly when the vault is a folder in Files. Sync’s private sandbox usually cannot use this."
        case .auto:
            return "Uses Files when linked; otherwise hands off to the Sync Shortcut."
        }
    }
}
