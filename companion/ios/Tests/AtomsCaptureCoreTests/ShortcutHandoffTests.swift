import XCTest
@testable import AtomsCaptureCore

final class ShortcutHandoffTests: XCTestCase {
    func testRunURLSendsStampedLineToAppendShortcut() throws {
        let line = "- 2026-07-28T17:23:34-04:00 hello"
        let url = try XCTUnwrap(ShortcutHandoff.runURL(stampedLine: line))
        XCTAssertEqual(url.scheme, "shortcuts")
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let dict = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(dict["name"], "Atoms Capture Append")
        XCTAssertEqual(dict["input"], "text")
        XCTAssertEqual(dict["text"], line)
    }

    func testRepositoryHandsStampedBody() throws {
        let settings = DeliverySettings(defaults: UserDefaults(suiteName: "test.s.\(UUID().uuidString)")!)
        settings.mode = .syncShortcut
        var opened: URL?
        let repo = CaptureRepository(
            store: VaultStore(defaults: UserDefaults(suiteName: "test.v.\(UUID().uuidString)")!),
            settings: settings,
            openURL: { url in opened = url; return true }
        )
        let status = repo.capture(body: "hi there")
        guard case .handedToShortcut = status else {
            return XCTFail("\(status)")
        }
        let text = URLComponents(url: opened!, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "text" })?.value
        XCTAssertTrue(text?.hasPrefix("- ") == true)
        XCTAssertTrue(text?.contains("hi there") == true)
        let name = URLComponents(url: opened!, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "name" })?.value
        XCTAssertEqual(name, "Atoms Capture Append")
    }

    func testShortcutNameConstant() {
        XCTAssertEqual(DeliverySettings.appendShortcutName, "Atoms Capture Append")
    }

    func testInstallURLIsSet() {
        XCTAssertTrue(DeliverySettings.appendShortcutICloudURL.contains("9f7425ab9eb94884b610667a69a8e38b"))
    }
}
