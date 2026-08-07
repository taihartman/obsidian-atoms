import SwiftUI

struct RootView: View {
    @EnvironmentObject private var appModel: AppModel

    var body: some View {
        ZStack {
            // Always keep hub underneath so cold-start has a root.
            HubView()
                .opacity(appModel.surface == .hub ? 1 : 0)
                .allowsHitTesting(appModel.surface == .hub)

            if appModel.surface == .quickCapture {
                // Android QuickCapture parity: dim + top strip only — not the setup hub.
                CaptureOverlay()
                    .transition(.opacity)
                    .zIndex(1)
            }
        }
        .animation(.easeOut(duration: 0.15), value: appModel.surface)
    }
}
