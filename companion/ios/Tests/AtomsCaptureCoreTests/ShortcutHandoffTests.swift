import XCTest
@testable import AtomsCaptureCore

final class ShortcutHandoffTests: XCTestCase {
    func testRunURLEncodesNameAndText() throws {
        let url = try XCTUnwrap(
            ShortcutHandoff.runURL(
                shortcutName: "Atoms Capture Append",
                text: "- 2026-07-28T17:23:34-04:00 hello world"
            )
        )
        XCTAssertEqual(url.scheme, "shortcuts")
        XCTAssertEqual(url.host, "run-shortcut")
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let dict = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(dict["name"], "Atoms Capture Append")
        XCTAssertEqual(dict["input"], "text")
        XCTAssertEqual(dict["text"], "- 2026-07-28T17:23:34-04:00 hello world")
    }

    func testStampedLineMatchesCaptureLine() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: -4 * 3600)!
        var c = DateComponents()
        c.year = 2026; c.month = 7; c.day = 28
        c.hour = 17; c.minute = 23; c.second = 34
        let fixed = calendar.date(from: c)!
        let line = try ShortcutHandoff.stampedLine(
            body: "hello",
            at: fixed,
            timeZone: TimeZone(secondsFromGMT: -4 * 3600)!
        )
        XCTAssertEqual(line, "- 2026-07-28T17:23:34-04:00 hello")
    }

    func testRepositoryShortcutModeOpensURL() {
        let settings = DeliverySettings(defaults: UserDefaults(suiteName: "test.shortcut.\(UUID().uuidString)")!)
        settings.mode = .syncShortcut
        settings.shortcutName = "Atoms Capture Append"

        var opened: URL?
        let repo = CaptureRepository(
            store: VaultStore(defaults: UserDefaults(suiteName: "test.vault.\(UUID().uuidString)")!),
            settings: settings,
            openURL: { url in
                opened = url
                return true
            }
        )
        let status = repo.capture(body: "from test")
        guard case .handedToShortcut = status else {
            return XCTFail("expected handedToShortcut, got \(status)")
        }
        XCTAssertEqual(opened?.scheme, "shortcuts")
        let items = opened.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.queryItems }
        let name = items?.first(where: { $0.name == "name" })?.value
        XCTAssertEqual(name, "Atoms Capture Append")
    }

    func testRepositoryShortcutModeFailsWhenOpenReturnsFalse() {
        let settings = DeliverySettings(defaults: UserDefaults(suiteName: "test.shortcut2.\(UUID().uuidString)")!)
        settings.mode = .syncShortcut
        let repo = CaptureRepository(
            store: VaultStore(defaults: UserDefaults(suiteName: "test.vault2.\(UUID().uuidString)")!),
            settings: settings,
            openURL: { _ in false }
        )
        let status = repo.capture(body: "x")
        guard case .failed = status else {
            return XCTFail("expected failed, got \(status)")
        }
    }
}
