import XCTest
@testable import AtomsCaptureCore

final class ShortcutHandoffTests: XCTestCase {
    func testRunURLTargetsCaptureAtom() throws {
        let url = try XCTUnwrap(ShortcutHandoff.runURL(body: "hello"))
        XCTAssertEqual(url.scheme, "shortcuts")
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let dict = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(dict["name"], "Capture Atom")
        XCTAssertEqual(dict["input"], "text")
        XCTAssertEqual(dict["text"], "hello")
    }

    func testRunURLWithoutBody() throws {
        let url = try XCTUnwrap(ShortcutHandoff.runURL(body: nil))
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].name, "name")
        XCTAssertEqual(items[0].value, "Capture Atom")
    }

    func testRepositoryOpensCaptureAtom() {
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
        let name = URLComponents(url: opened!, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "name" })?.value
        XCTAssertEqual(name, "Capture Atom")
        let text = URLComponents(url: opened!, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "text" })?.value
        XCTAssertEqual(text, "hi there")
    }

    func testInstallURLIsCaptureAtomV22() {
        XCTAssertEqual(DeliverySettings.captureAtomName, "Capture Atom")
        XCTAssertTrue(
            DeliverySettings.captureAtomICloudURL.contains("d6ee1009562c4a9a9694f36a5f0c0187")
        )
    }
}
