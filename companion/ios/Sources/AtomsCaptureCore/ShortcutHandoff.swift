import Foundation

/// Builds the URL that runs a Shortcuts.app shortcut with the stamped capture line as text input.
///
/// The companion formats the full inbox line (stamp + body). The Shortcut should only:
/// **Receive Text Input → Append to Bookmark (Atoms Inbox)**.
/// That is the only free way into an Obsidian Sync Remote Vault from another app on iOS.
public enum ShortcutHandoff {
    public static func runURL(shortcutName: String, text: String) -> URL? {
        var components = URLComponents()
        components.scheme = "shortcuts"
        components.host = "run-shortcut"
        components.queryItems = [
            URLQueryItem(name: "name", value: shortcutName),
            URLQueryItem(name: "input", value: "text"),
            URLQueryItem(name: "text", value: text),
        ]
        return components.url
    }

    /// Full stamped line ready to append (bookmark adds its own trailing newline).
    public static func stampedLine(
        body: String,
        at date: Date = Date(),
        timeZone: TimeZone = .current
    ) throws -> String {
        try CaptureLine.format(body: body, at: date, timeZone: timeZone).line
    }
}
