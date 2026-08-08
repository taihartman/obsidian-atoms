import XCTest
@testable import AtomsCaptureCore

final class CaptureLineTests: XCTestCase {
    /// Fixed clock matching Android CaptureLineTest.
    private var fixed: Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: -4 * 3600)!
        var components = DateComponents()
        components.year = 2026
        components.month = 7
        components.day = 28
        components.hour = 17
        components.minute = 23
        components.second = 34
        return calendar.date(from: components)!
    }

    private var tokyoish: Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 9 * 3600)!
        var components = DateComponents()
        components.year = 2026
        components.month = 8
        components.day = 7
        components.hour = 9
        components.minute = 0
        components.second = 1
        return calendar.date(from: components)!
    }

    func testFormatsStampWithColonOffsetAndSeconds() throws {
        let result = try CaptureLine.format(
            body: "hello",
            at: fixed,
            timeZone: TimeZone(secondsFromGMT: -4 * 3600)!
        )
        XCTAssertEqual(result.stamp, "2026-07-28T17:23:34-04:00")
        XCTAssertEqual(result.line, "- 2026-07-28T17:23:34-04:00 hello")
    }

    func testRejectsEmptyBody() {
        XCTAssertThrowsError(
            try CaptureLine.format(
                body: "   ",
                at: fixed,
                timeZone: TimeZone(secondsFromGMT: -4 * 3600)!
            )
        ) { error in
            let message = String(describing: error)
            XCTAssertTrue(message.lowercased().contains("empty"), message)
        }
    }

    func testMultilineBecomesTabContinuations() throws {
        let result = try CaptureLine.format(
            body: "line one\nline two\nline three",
            at: fixed,
            timeZone: TimeZone(secondsFromGMT: -4 * 3600)!
        )
        XCTAssertEqual(
            result.line,
            "- 2026-07-28T17:23:34-04:00 line one\n\tline two\n\tline three"
        )
    }

    func testPositiveOffsetUsesColon() throws {
        let result = try CaptureLine.format(
            body: "hi",
            at: tokyoish,
            timeZone: TimeZone(secondsFromGMT: 9 * 3600)!
        )
        XCTAssertEqual(result.stamp, "2026-08-07T09:00:01+09:00")
        let bareOffset = try! NSRegularExpression(pattern: "[+-]\\d{4}$")
        let range = NSRange(result.stamp.startIndex..., in: result.stamp)
        XCTAssertNil(
            bareOffset.firstMatch(in: result.stamp, range: range),
            "must not use Z-style +0900"
        )
    }

    func testMergeAppendCreatesTemplateWhenEmpty() {
        let merged = CaptureLine.mergeAppend(
            existing: "",
            captureLine: "- 2026-07-28T17:23:34-04:00 first"
        )
        XCTAssertTrue(merged.contains("atoms-inbox: true"))
        XCTAssertTrue(merged.hasSuffix("- 2026-07-28T17:23:34-04:00 first\n"))
        XCTAssertTrue(
            merged.contains("Atoms System") || merged.contains("Capture inbox")
        )
    }

    func testMergeAppendAddsNewlineWhenMissing() {
        let merged = CaptureLine.mergeAppend(
            existing: "existing",
            captureLine: "- 2026-07-28T17:23:34-04:00 next"
        )
        XCTAssertEqual(merged, "existing\n- 2026-07-28T17:23:34-04:00 next\n")
    }

    func testMergeAppendKeepsExistingTrailingNewline() {
        let merged = CaptureLine.mergeAppend(
            existing: "existing\n",
            captureLine: "- 2026-07-28T17:23:34-04:00 next"
        )
        XCTAssertEqual(merged, "existing\n- 2026-07-28T17:23:34-04:00 next\n")
    }

    func testPathConstantsMatchPlugin() {
        XCTAssertEqual(CaptureLine.systemFolder, "Atoms System")
        XCTAssertEqual(CaptureLine.inboxFileName, "Inbox.md")
        XCTAssertEqual(CaptureLine.inboxRelativePath, "Atoms System/Inbox.md")
    }
}
