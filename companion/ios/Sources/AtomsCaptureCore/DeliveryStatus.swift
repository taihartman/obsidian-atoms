import Foundation

public enum DeliveryStatus: Equatable, Sendable {
    case inVault
    case handedToShortcut
    case failed(reason: String)

    public var label: String {
        switch self {
        case .inVault: return "In vault"
        case .handedToShortcut: return "Opened Capture Atom"
        case .failed: return "Failed"
        }
    }

    public var detail: String? {
        switch self {
        case .inVault, .handedToShortcut: return nil
        case .failed(let reason): return reason
        }
    }

    public var isSuccess: Bool {
        switch self {
        case .inVault, .handedToShortcut: return true
        case .failed: return false
        }
    }
}

public enum DeliveryMode: String, CaseIterable, Codable, Sendable {
    case syncShortcut = "sync_shortcut"
    case files = "files"
    case auto = "auto"

    public var title: String {
        switch self {
        case .syncShortcut: return "Obsidian Sync (Capture Atom)"
        case .files: return "Files folder"
        case .auto: return "Auto"
        }
    }

    public var blurb: String {
        switch self {
        case .syncShortcut:
            return "Uses Capture Atom — the system Shortcut card (best one-second feel on iOS)."
        case .files:
            return "Direct write to a Files-visible vault folder."
        case .auto:
            return "Files if linked, else Capture Atom."
        }
    }
}
