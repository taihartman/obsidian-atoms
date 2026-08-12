import XCTest
@testable import AtomsCaptureCore

final class InboxWriterTests: XCTestCase {
    private var tmp: URL!

    override func setUpWithError() throws {
        tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("AtomsCaptureTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: tmp)
    }

    private var fixed: Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: -4 * 3600)!
        var c = DateComponents()
        c.year = 2026; c.month = 7; c.day = 28
        c.hour = 17; c.minute = 23; c.second = 34
        return calendar.date(from: c)!
    }

    private var tz: TimeZone { TimeZone(secondsFromGMT: -4 * 3600)! }

    func testFirstWriteCreatesInboxWithTemplateAndLine() throws {
        let vault = tmp.appendingPathComponent("Vault", isDirectory: true)
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)

        let writer = InboxWriter(fileManager: .default)
        let result = writer.append(
            body: "first thought",
            vaultRoot: vault,
            at: fixed,
            timeZone: tz
        )

        guard case .inVault = result else {
            return XCTFail("expected inVault, got \(result)")
        }

        let inbox = vault
            .appendingPathComponent(CaptureLine.systemFolder, isDirectory: true)
            .appendingPathComponent(CaptureLine.inboxFileName)
        let text = try String(contentsOf: inbox, encoding: .utf8)
        XCTAssertTrue(text.contains("atoms-inbox: true"))
        XCTAssertTrue(text.contains("- 2026-07-28T17:23:34-04:00 first thought"))
    }

    func testSecondWritePreservesFirstLine() throws {
        let vault = tmp.appendingPathComponent("Vault2", isDirectory: true)
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        let writer = InboxWriter(fileManager: .default)

        _ = writer.append(body: "first", vaultRoot: vault, at: fixed, timeZone: tz)

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = tz
        var c = DateComponents()
        c.year = 2026; c.month = 7; c.day = 28
        c.hour = 17; c.minute = 24; c.second = 0
        let later = calendar.date(from: c)!

        _ = writer.append(body: "second", vaultRoot: vault, at: later, timeZone: tz)

        let inbox = vault
            .appendingPathComponent(CaptureLine.systemFolder, isDirectory: true)
            .appendingPathComponent(CaptureLine.inboxFileName)
        let text = try String(contentsOf: inbox, encoding: .utf8)
        XCTAssertTrue(text.contains("first"))
        XCTAssertTrue(text.contains("second"))
        XCTAssertTrue(text.contains("- 2026-07-28T17:23:34-04:00 first"))
        XCTAssertTrue(text.contains("- 2026-07-28T17:24:00-04:00 second"))
    }

    func testEmptyBodyFailsWithoutCreatingInbox() throws {
        let vault = tmp.appendingPathComponent("Vault3", isDirectory: true)
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        let writer = InboxWriter(fileManager: .default)

        let result = writer.append(body: "  ", vaultRoot: vault, at: fixed, timeZone: tz)
        guard case .failed(let reason) = result else {
            return XCTFail("expected failed, got \(result)")
        }
        XCTAssertTrue(reason.lowercased().contains("empty"), reason)

        let system = vault.appendingPathComponent(CaptureLine.systemFolder, isDirectory: true)
        XCTAssertFalse(FileManager.default.fileExists(atPath: system.path))
    }

    func testReadFailureDoesNotWipeExisting() throws {
        let vault = tmp.appendingPathComponent("Vault4", isDirectory: true)
        let system = vault.appendingPathComponent(CaptureLine.systemFolder, isDirectory: true)
        try FileManager.default.createDirectory(at: system, withIntermediateDirectories: true)
        let inbox = system.appendingPathComponent(CaptureLine.inboxFileName)
        let precious = "---\natoms-inbox: true\n---\n\nkeep me\n"
        try precious.write(to: inbox, atomically: true, encoding: .utf8)

        // Point writer at a path that exists as a *directory* named Inbox.md so read fails oddly —
        // better: inject a failing reader.
        let writer = InboxWriter(
            fileManager: .default,
            readText: { _ in throw CocoaError(.fileReadNoPermission) }
        )
        let result = writer.append(body: "new", vaultRoot: vault, at: fixed, timeZone: tz)
        guard case .failed = result else {
            return XCTFail("expected failed, got \(result)")
        }
        let after = try String(contentsOf: inbox, encoding: .utf8)
        XCTAssertEqual(after, precious)
    }

    func testMissingVaultRootFails() throws {
        let missing = tmp.appendingPathComponent("no-such-vault", isDirectory: true)
        let writer = InboxWriter(fileManager: .default)
        let result = writer.append(body: "x", vaultRoot: missing, at: fixed, timeZone: tz)
        guard case .failed = result else {
            return XCTFail("expected failed, got \(result)")
        }
    }

    func testNonEmptyFileWithEmptyReadDoesNotWipe() throws {
        let vault = tmp.appendingPathComponent("Vault5", isDirectory: true)
        let system = vault.appendingPathComponent(CaptureLine.systemFolder, isDirectory: true)
        try FileManager.default.createDirectory(at: system, withIntermediateDirectories: true)
        let inbox = system.appendingPathComponent(CaptureLine.inboxFileName)
        let precious = Data(repeating: 0x41, count: 64) // non-UTF8-empty bytes that may decode poorly
        // Write real text then inject empty read while size > 0
        try "keep me forever\n".write(to: inbox, atomically: true, encoding: .utf8)
        let writer = InboxWriter(
            fileManager: .default,
            readText: { _ in "" }
        )
        let result = writer.append(body: "new", vaultRoot: vault, at: fixed, timeZone: tz)
        guard case .failed = result else {
            return XCTFail("expected failed, got \(result)")
        }
        let after = try String(contentsOf: inbox, encoding: .utf8)
        XCTAssertEqual(after, "keep me forever\n")
        _ = precious // silence unused if we keep binary path later
    }
}
