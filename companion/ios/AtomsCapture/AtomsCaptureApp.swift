import SwiftUI
import AtomsCaptureCore

@main
struct AtomsCaptureApp: App {
    @StateObject private var appModel = AppModel()

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
    let store = VaultStore()
    lazy var repository = CaptureRepository(store: store)

    @Published var showCapture = false
    @Published var statusMessage: String?

    func handle(url: URL) {
        guard url.scheme == "atomscapture" else { return }
        if url.host == "capture" || url.path.contains("capture") {
            showCapture = true
        }
    }

    func refreshStatus() {
        objectWillChange.send()
    }
}
