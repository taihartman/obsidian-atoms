import AppIntents
import UIKit

/// Opens the quick-capture strip (not the setup hub) — widget / Action Button / Control Center.
struct CaptureThoughtIntent: AppIntent {
    static var title: LocalizedStringResource = "Capture thought"
    static var description = IntentDescription(
        "Open the Atoms Capture strip to save a thought."
    )
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        AppModel.shared.presentQuickCapture()
        // Also poke the URL path for cold start reliability.
        if let url = URL(string: "atomscapture://capture") {
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
                "New thought in \(.applicationName)",
            ],
            shortTitle: "Capture",
            systemImageName: "plus.circle"
        )
    }
}
