import SwiftUI
import UIKit
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
    let delivery = DeliverySettings()
    lazy var repository: CaptureRepository = CaptureRepository(
        store: store,
        settings: delivery,
        openURL: { url in
            // Fire-and-forget on main. We cannot know if the Shortcut succeeded —
            // status is *Handed to Shortcut*. Avoid semaphore (deadlock if already on main).
            let open = {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
            }
            if Thread.isMainThread {
                open()
            } else {
                DispatchQueue.main.async(execute: open)
            }
            return true
        }
    )

    @Published var showCapture = false
    @Published var statusMessage: String?

    func handle(url: URL) {
        guard url.scheme == "atomscapture" else { return }
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
