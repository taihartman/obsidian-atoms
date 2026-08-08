import SwiftUI
import UIKit
import AtomsCaptureCore

@main
struct AtomsCaptureApp: App {
    @StateObject private var appModel = AppModel.shared

    var body: some Scene {
        WindowGroup {
            HubView()
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
            // Best-effort sync open; true only means we requested open.
            if Thread.isMainThread {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
            } else {
                DispatchQueue.main.async {
                    UIApplication.shared.open(url, options: [:], completionHandler: nil)
                }
            }
            return true
        }
    )

    func handle(url: URL) {
        guard url.scheme == "atomscapture" else { return }
        if url.host == "capture" || url.path == "/capture" || url.path == "capture" {
            _ = repository.openCaptureAtomUI()
        }
    }

    func refreshStatus() {
        objectWillChange.send()
    }
}
