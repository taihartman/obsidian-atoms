import SwiftUI
import AtomsCaptureCore

@main
struct AtomsCaptureApp: App {
    @StateObject private var appModel = AppModel.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appModel)
                .onOpenURL { url in
                    appModel.handle(url: url)
                }
        }
    }
}

@MainActor
final class AppModel: ObservableObject {
    static let shared = AppModel()

    let store = VaultStore()
    lazy var repository = CaptureRepository(store: store)

    @Published var showCapture = false
    @Published var statusMessage: String?

    func handle(url: URL) {
        guard url.scheme == "atomscapture" else { return }
        // Only atomscapture://capture (host or exact path).
        if url.host == "capture" || url.path == "/capture" || url.path == "capture" {
            showCapture = true
        }
    }

    func presentCapture() {
        showCapture = true
    }

    func refreshStatus() {
        objectWillChange.send()
    }
}
