import Foundation

/// Persists the linked vault bookmark + display name for app and extensions.
///
/// Uses a suite name when provided (App Group for widget/intents); otherwise standard defaults.
public final class VaultStore: @unchecked Sendable {
    public static let defaultSuiteName = "group.app.tryatoms.capture"

    private let defaults: UserDefaults
    private let bookmarkKey = "vault_bookmark"
    private let nameKey = "vault_display_name"
    private let pathHintKey = "vault_path_hint"

    public init(defaults: UserDefaults? = nil, suiteName: String? = VaultStore.defaultSuiteName) {
        if let defaults {
            self.defaults = defaults
        } else if let suiteName, let suite = UserDefaults(suiteName: suiteName) {
            self.defaults = suite
        } else {
            self.defaults = .standard
        }
    }

    public var isLinked: Bool {
        defaults.data(forKey: bookmarkKey) != nil
    }

    public var displayName: String? {
        defaults.string(forKey: nameKey)
    }

    public var pathHint: String? {
        defaults.string(forKey: pathHintKey)
    }

    public func saveBookmark(data: Data, displayName: String, pathHint: String?) {
        defaults.set(data, forKey: bookmarkKey)
        defaults.set(displayName, forKey: nameKey)
        if let pathHint {
            defaults.set(pathHint, forKey: pathHintKey)
        } else {
            defaults.removeObject(forKey: pathHintKey)
        }
    }

    public func clear() {
        defaults.removeObject(forKey: bookmarkKey)
        defaults.removeObject(forKey: nameKey)
        defaults.removeObject(forKey: pathHintKey)
    }

    public func bookmarkData() -> Data? {
        defaults.data(forKey: bookmarkKey)
    }

    /// Resolve bookmark to a URL. Caller must start/stop security-scoped access on iOS.
    public func resolveURL() throws -> URL {
        guard let data = bookmarkData() else {
            throw VaultStoreError.notLinked
        }
        var isStale = false
        #if os(macOS)
        let url = try URL(
            resolvingBookmarkData: data,
            options: [.withSecurityScope],
            relativeTo: nil,
            bookmarkDataIsStale: &isStale
        )
        #else
        let url = try URL(
            resolvingBookmarkData: data,
            options: [],
            relativeTo: nil,
            bookmarkDataIsStale: &isStale
        )
        #endif
        if isStale {
            throw VaultStoreError.bookmarkStale
        }
        return url
    }

    /// Create bookmark data suitable for the current platform from a security-scoped URL.
    public static func makeBookmarkData(from url: URL) throws -> Data {
        #if os(macOS)
        return try url.bookmarkData(
            options: [.withSecurityScope],
            includingResourceValuesForKeys: nil,
            relativeTo: nil
        )
        #else
        return try url.bookmarkData(
            options: [],
            includingResourceValuesForKeys: nil,
            relativeTo: nil
        )
        #endif
    }
}

public enum VaultStoreError: Error, LocalizedError, Equatable {
    case notLinked
    case bookmarkStale

    public var errorDescription: String? {
        switch self {
        case .notLinked:
            return "No vault linked. Open the hub and choose a Files-visible vault folder."
        case .bookmarkStale:
            return "Vault link expired. Re-link the vault folder in the hub."
        }
    }
}
