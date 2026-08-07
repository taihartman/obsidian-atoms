import AppIntents
import UIKit
import AtomsCaptureCore

/// Runs **Capture Atom** (not the setup hub) — Action Button / Siri / Shortcuts.
struct CaptureThoughtIntent: AppIntent {
    static var title: LocalizedStringResource = "Capture thought"
    static var description = IntentDescription(
        "Open Capture Atom to save a thought into your vault inbox."
    )
    /// Don’t need our UI — Shortcuts presents Capture Atom.
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult {
        if let url = ShortcutHandoff.runURL(body: nil) {
            await UIApplication.shared.open(url)
        }
        return .result()
    }
}

struct AtomsCaptureShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CaptureThoughtIntent(),
            phrases: [
                "Capture with \(.applicationName)",
                "Capture a thought with \(.applicationName)",
            ],
            shortTitle: "Capture",
            systemImageName: "plus.circle"
        )
    }
}
