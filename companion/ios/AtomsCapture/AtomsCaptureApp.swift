import SwiftUI
import UIKit
import AtomsCaptureCore

@main
struct AtomsCaptureApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var appModel = AppModel.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appModel)
                .onOpenURL { url in
                    appModel.handle(url: url)
                }
                .onAppear {
                    appModel.consumePendingQuickLaunch()
                }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Cold start from URL / shortcut
        if let url = launchOptions?[.url] as? URL {
            AppModel.shared.handle(url: url)
        }
        return true
    }

    func application(
        _ app: UIApplication,
        open url: URL,
        options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    ) -> Bool {
        AppModel.shared.handle(url: url)
        return true
    }
}

/// hub = full setup screen · quickCapture = Android-style strip only (widget / CC / Action Button)
enum LaunchSurface: Equatable {
    case hub
    case quickCapture
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

    @Published var surface: LaunchSurface = .hub
    /// Legacy binding for sheet-style present; quick path uses `surface` instead.
    @Published var showCapture = false

    private var pendingQuick = false

    func handle(url: URL) {
        guard url.scheme == "atomscapture" else { return }
        if url.host == "capture" || url.path == "/capture" || url.path == "capture" {
            presentQuickCapture()
        } else if url.host == "hub" {
            surface = .hub
            showCapture = false
        }
    }

    func presentQuickCapture() {
        pendingQuick = true
        surface = .quickCapture
        showCapture = true
    }

    func presentCapture() {
        presentQuickCapture()
    }

    func dismissQuickCapture() {
        surface = .hub
        showCapture = false
        pendingQuick = false
    }

    func consumePendingQuickLaunch() {
        if pendingQuick {
            surface = .quickCapture
            showCapture = true
        }
    }

    func refreshStatus() {
        objectWillChange.send()
    }
}
