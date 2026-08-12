import Foundation

/// Wire contract shared with the Obsidian plugin inbox drain.
///
/// Shape: `- 2026-07-28T17:23:34-04:00 capture text`
///
/// - ISO-8601 local datetime with colon offset and seconds
/// - Multiline body: newlines become tab-indented continuations
/// - Body is never rewritten beyond that whitespace rule
///
/// See: docs/capture-shortcut.md, src/pipeline/inbox.ts,
/// companion/android/.../domain/CaptureLine.kt
public enum CaptureLine {
    public static let systemFolder = "Atoms System"
    public static let inboxFileName = "Inbox.md"
    public static let inboxRelativePath = "\(systemFolder)/\(inboxFileName)"

    /// Header for a freshly created inbox note — same spirit as Android / plugin.
    public static let inboxNoteTemplate = """
    ---
    atoms-inbox: true
    ---

    Capture inbox. Atoms Capture appends here, and the Atoms plugin files
    each line into the daily note for the day it was captured.

    Lines are marked once filed and are never deleted by Atoms.

    Do not move or rename this note — capture points at this exact path.


    """

    public struct Result: Equatable, Sendable {
        public let line: String
        public let stamp: String

        public init(line: String, stamp: String) {
            self.line = line
            self.stamp = stamp
        }
    }

    public enum FormatError: Error, LocalizedError, Equatable {
        case emptyBody

        public var errorDescription: String? {
            switch self {
            case .emptyBody:
                return "Capture text is empty"
            }
        }
    }

    public static func format(
        body: String,
        at date: Date = Date(),
        timeZone: TimeZone = .current
    ) throws -> Result {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw FormatError.emptyBody }

        let stamp = formatStamp(date: date, timeZone: timeZone)
        let normalizedBody = normalizeMultiline(trimmed)
        let line = "- \(stamp) \(normalizedBody)"
        return Result(line: line, stamp: stamp)
    }

    /// Newlines become tab-indented continuation lines (Shortcut recipe / Android).
    public static func normalizeMultiline(_ body: String) -> String {
        body
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .replacingOccurrences(of: "\n", with: "\n\t")
    }

    /// Prepare file content for append: ensure trailing newline on existing body,
    /// then add the new capture line and a final newline.
    public static func mergeAppend(existing: String, captureLine: String) -> String {
        let base: String
        if existing.isEmpty {
            base = inboxNoteTemplate
        } else if existing.hasSuffix("\n") {
            base = existing
        } else {
            base = existing + "\n"
        }
        return base + captureLine + "\n"
    }

    // MARK: - Stamp

    /// `yyyy-MM-dd'T'HH:mm:ss±HH:MM` with colon offset (never `±HHMM`).
    public static func formatStamp(date: Date, timeZone: TimeZone) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents(
            [.year, .month, .day, .hour, .minute, .second],
            from: date
        )
        let year = parts.year ?? 0
        let month = parts.month ?? 0
        let day = parts.day ?? 0
        let hour = parts.hour ?? 0
        let minute = parts.minute ?? 0
        let second = parts.second ?? 0

        let offsetSeconds = timeZone.secondsFromGMT(for: date)
        let sign = offsetSeconds >= 0 ? "+" : "-"
        let absOffset = abs(offsetSeconds)
        let offsetHours = absOffset / 3600
        let offsetMinutes = (absOffset % 3600) / 60

        return String(
            format: "%04d-%02d-%02dT%02d:%02d:%02d%@%02d:%02d",
            year, month, day, hour, minute, second,
            sign, offsetHours, offsetMinutes
        )
    }
}
