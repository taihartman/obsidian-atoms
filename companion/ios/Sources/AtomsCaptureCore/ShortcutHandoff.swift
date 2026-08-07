import Foundation

/// Runs **Capture Atom** (system Shortcut card = iOS “overlay”).
/// Pass capture **body** only — Capture Atom owns stamp + append.
public enum ShortcutHandoff {
    public static func runURL(
        shortcutName: String = DeliverySettings.captureAtomName,
        body: String? = nil
    ) -> URL? {
        var components = URLComponents()
        components.scheme = "shortcuts"
        components.host = "run-shortcut"
        var items = [URLQueryItem(name: "name", value: shortcutName)]
        if let body {
            let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                items.append(URLQueryItem(name: "input", value: "text"))
                items.append(URLQueryItem(name: "text", value: trimmed))
            }
        }
        components.queryItems = items
        return components.url
    }
}
