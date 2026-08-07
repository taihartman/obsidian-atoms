import Foundation

/// Runs **Atoms Capture Append** with a **pre-stamped** inbox line.
///
/// Shortcut is append-only (no Type/Voice). Companion owns capture UX + stamp.
public enum ShortcutHandoff {
    public static func runURL(
        shortcutName: String = DeliverySettings.appendShortcutName,
        stampedLine: String
    ) -> URL? {
        var components = URLComponents()
        components.scheme = "shortcuts"
        components.host = "run-shortcut"
        components.queryItems = [
            URLQueryItem(name: "name", value: shortcutName),
            URLQueryItem(name: "input", value: "text"),
            URLQueryItem(name: "text", value: stampedLine),
        ]
        return components.url
    }

    public static func stampedLine(
        body: String,
        at date: Date = Date(),
        timeZone: TimeZone = .current
    ) throws -> String {
        try CaptureLine.format(body: body, at: date, timeZone: timeZone).line
    }
}
