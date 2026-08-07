import Foundation

public enum CaptureActivityPhase: String, Codable, Hashable, Sendable {
    case idle
    case listening
    case saving
    case inVault
    case failed

    public var title: String {
        switch self {
        case .idle: return "Atoms Capture"
        case .listening: return "Listening"
        case .saving: return "Saving"
        case .inVault: return "In vault"
        case .failed: return "Failed"
        }
    }
}

#if os(iOS)
import ActivityKit

public struct CaptureActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable, Sendable {
        public var phase: CaptureActivityPhase
        public var preview: String

        public init(phase: CaptureActivityPhase, preview: String) {
            self.phase = phase
            self.preview = preview
        }
    }

    public var startedAt: Date

    public init(startedAt: Date) {
        self.startedAt = startedAt
    }
}
#endif
