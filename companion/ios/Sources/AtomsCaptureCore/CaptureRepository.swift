import Foundation

/// Single write façade for hub, sheet, intents, and Live Activity actions.
public final class CaptureRepository: @unchecked Sendable {
    private let store: VaultStore
    private let writer: InboxWriter
    private let resolveURL: () throws -> URL
    private let startAccess: (URL) -> Bool
    private let stopAccess: (URL) -> Void

    public init(
        store: VaultStore = VaultStore(),
        writer: InboxWriter = InboxWriter(),
        resolveURL: (() throws -> URL)? = nil,
        startAccess: ((URL) -> Bool)? = nil,
        stopAccess: ((URL) -> Void)? = nil
    ) {
        self.store = store
        self.writer = writer
        self.resolveURL = resolveURL ?? { try store.resolveURL() }
        self.startAccess = startAccess ?? { $0.startAccessingSecurityScopedResource() }
        self.stopAccess = stopAccess ?? { $0.stopAccessingSecurityScopedResource() }
    }

    public func capture(
        body: String,
        at date: Date = Date(),
        timeZone: TimeZone = .current
    ) -> DeliveryStatus {
        let url: URL
        do {
            url = try resolveURL()
        } catch {
            return .failed(reason: error.localizedDescription)
        }

        let accessed = startAccess(url)
        defer {
            if accessed { stopAccess(url) }
        }
        if !accessed {
            // Still try path-based write for non-scoped URLs (tests / already-accessible).
        }

        do {
            return try writer.append(body: body, vaultRoot: url, at: date, timeZone: timeZone)
        } catch {
            return .failed(reason: error.localizedDescription)
        }
    }
}
