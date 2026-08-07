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
        // Tests inject startAccess → true. Real bookmark URLs must grant scope.
        if !accessed {
            return .failed(reason: "Could not access the linked vault. Re-link the folder in the hub.")
        }

        return writer.append(body: body, vaultRoot: url, at: date, timeZone: timeZone)
    }
}
