import Foundation

/// Single write façade for hub, sheet, intents, and Live Activity actions.
public final class CaptureRepository: @unchecked Sendable {
    public typealias OpenURL = (URL) -> Bool

    private let store: VaultStore
    private let settings: DeliverySettings
    private let writer: InboxWriter
    private let resolveURL: () throws -> URL
    private let startAccess: (URL) -> Bool
    private let stopAccess: (URL) -> Void
    private let openURL: OpenURL

    public init(
        store: VaultStore = VaultStore(),
        settings: DeliverySettings = DeliverySettings(),
        writer: InboxWriter = InboxWriter(),
        resolveURL: (() throws -> URL)? = nil,
        startAccess: ((URL) -> Bool)? = nil,
        stopAccess: ((URL) -> Void)? = nil,
        openURL: OpenURL? = nil
    ) {
        self.store = store
        self.settings = settings
        self.writer = writer
        self.resolveURL = resolveURL ?? { try store.resolveURL() }
        self.startAccess = startAccess ?? { $0.startAccessingSecurityScopedResource() }
        self.stopAccess = stopAccess ?? { $0.stopAccessingSecurityScopedResource() }
        self.openURL = openURL ?? { _ in false }
    }

    public func capture(
        body: String,
        at date: Date = Date(),
        timeZone: TimeZone = .current
    ) -> DeliveryStatus {
        switch settings.mode {
        case .files:
            return captureToFiles(body: body, at: date, timeZone: timeZone)
        case .syncShortcut:
            return captureToAppendShortcut(body: body, at: date, timeZone: timeZone)
        case .auto:
            if store.isLinked {
                let files = captureToFiles(body: body, at: date, timeZone: timeZone)
                if case .inVault = files { return files }
            }
            return captureToAppendShortcut(body: body, at: date, timeZone: timeZone)
        }
    }

    private func captureToFiles(
        body: String,
        at date: Date,
        timeZone: TimeZone
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
            return .failed(reason: "Could not access the linked vault. Re-link the folder in the hub.")
        }

        return writer.append(body: body, vaultRoot: url, at: date, timeZone: timeZone)
    }

    private func captureToAppendShortcut(
        body: String,
        at date: Date,
        timeZone: TimeZone
    ) -> DeliveryStatus {
        let line: String
        do {
            line = try ShortcutHandoff.stampedLine(body: body, at: date, timeZone: timeZone)
        } catch {
            return .failed(reason: error.localizedDescription)
        }

        guard let url = ShortcutHandoff.runURL(stampedLine: line) else {
            return .failed(reason: "Could not build Shortcut URL.")
        }

        let opened = openURL(url)
        if !opened {
            return .failed(
                reason: "Could not open “\(DeliverySettings.appendShortcutName)”. Install it once from the hub (Install button), then try again."
            )
        }
        return .handedToShortcut
    }
}
