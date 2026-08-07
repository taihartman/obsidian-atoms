import Foundation

/// Appends stamped capture lines under a vault root (Files-visible path).
///
/// Never treats a failed read as empty (wipe hazard). Serializes writes.
public final class InboxWriter: @unchecked Sendable {
    public typealias ReadText = (URL) throws -> String
    public typealias WriteText = (String, URL) throws -> Void

    private let fileManager: FileManager
    private let readText: ReadText
    private let writeText: WriteText
    private let lock = NSLock()

    public init(
        fileManager: FileManager = .default,
        readText: ReadText? = nil,
        writeText: WriteText? = nil
    ) {
        self.fileManager = fileManager
        self.readText = readText ?? { url in
            try String(contentsOf: url, encoding: .utf8)
        }
        self.writeText = writeText ?? { text, url in
            try Self.atomicWrite(text: text, to: url, fileManager: fileManager)
        }
    }

    public func append(
        body: String,
        vaultRoot: URL,
        at date: Date = Date(),
        timeZone: TimeZone = .current
    ) throws -> DeliveryStatus {
        lock.lock()
        defer { lock.unlock() }

        let formatted: CaptureLine.Result
        do {
            formatted = try CaptureLine.format(body: body, at: date, timeZone: timeZone)
        } catch CaptureLine.FormatError.emptyBody {
            return .failed(reason: "Capture text is empty")
        }

        var isDir: ObjCBool = false
        guard fileManager.fileExists(atPath: vaultRoot.path, isDirectory: &isDir), isDir.boolValue else {
            return .failed(reason: "Vault folder is missing. Re-link a Files-visible vault in the hub.")
        }

        let systemDir = vaultRoot.appendingPathComponent(CaptureLine.systemFolder, isDirectory: true)
        if !fileManager.fileExists(atPath: systemDir.path) {
            do {
                try fileManager.createDirectory(at: systemDir, withIntermediateDirectories: true)
            } catch {
                return .failed(reason: "Could not create \(CaptureLine.systemFolder): \(error.localizedDescription)")
            }
        }

        let inbox = systemDir.appendingPathComponent(CaptureLine.inboxFileName)

        let existing: String
        if fileManager.fileExists(atPath: inbox.path) {
            do {
                existing = try readText(inbox)
            } catch {
                // Never treat failed read as empty — that would wipe Inbox.md.
                return .failed(reason: "Could not read Inbox.md: \(error.localizedDescription)")
            }
        } else {
            existing = ""
        }

        let merged = CaptureLine.mergeAppend(existing: existing, captureLine: formatted.line)
        do {
            try writeText(merged, inbox)
        } catch {
            return .failed(reason: "Could not write Inbox.md: \(error.localizedDescription)")
        }

        return .inVault
    }

    /// Temp sibling + replace (Android atomicWriteText spirit).
    public static func atomicWrite(text: String, to url: URL, fileManager: FileManager = .default) throws {
        let dir = url.deletingLastPathComponent()
        if !fileManager.fileExists(atPath: dir.path) {
            try fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        let temp = dir.appendingPathComponent(".\(url.lastPathComponent).\(UUID().uuidString).tmp")
        try text.write(to: temp, atomically: true, encoding: .utf8)
        if fileManager.fileExists(atPath: url.path) {
            _ = try fileManager.replaceItemAt(url, withItemAt: temp)
        } else {
            try fileManager.moveItem(at: temp, to: url)
        }
    }
}
