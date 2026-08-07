import AppIntents
import UIKit

struct CaptureThoughtIntent: AppIntent {
    static var title: LocalizedStringResource = "Capture thought"
    static var description = IntentDescription(
        "Open Atoms Capture to save a thought into your vault inbox."
    )
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
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
