import Foundation
import AtomsCaptureCore

#if os(iOS)
import ActivityKit

@MainActor
final class CaptureActivityController {
    private var activity: Activity<CaptureActivityAttributes>?

    func start(preview: String) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let attributes = CaptureActivityAttributes(startedAt: Date())
        let state = CaptureActivityAttributes.ContentState(phase: .listening, preview: truncated(preview))
        do {
            activity = try Activity.request(
                attributes: attributes,
                content: .init(state: state, staleDate: nil),
                pushType: nil
            )
        } catch {
            activity = nil
        }
    }

    func update(phase: CaptureActivityPhase, preview: String) {
        guard let activity else { return }
        let state = CaptureActivityAttributes.ContentState(phase: phase, preview: truncated(preview))
        Task {
            await activity.update(.init(state: state, staleDate: nil))
        }
    }

    func end() {
        guard let activity else { return }
        let state = CaptureActivityAttributes.ContentState(phase: .idle, preview: "")
        Task {
            await activity.end(.init(state: state, staleDate: nil), dismissalPolicy: .immediate)
        }
        self.activity = nil
    }

    private func truncated(_ text: String) -> String {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.count <= 80 { return t }
        return String(t.prefix(77)) + "…"
    }
}
#else
@MainActor
final class CaptureActivityController {
    func start(preview: String) {}
    func update(phase: CaptureActivityPhase, preview: String) {}
    func end() {}
}
#endif
