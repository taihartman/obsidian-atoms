import Foundation

/// Honest post-save status (R6). No Shortcut arm in this POC.
public enum DeliveryStatus: Equatable, Sendable {
    case inVault
    case failed(reason: String)

    public var label: String {
        switch self {
        case .inVault:
            return "In vault"
        case .failed:
            return "Failed"
        }
    }

    public var detail: String? {
        switch self {
        case .inVault:
            return nil
        case .failed(let reason):
            return reason
        }
    }
}
