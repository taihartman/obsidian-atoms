import SwiftUI

struct RootView: View {
    @EnvironmentObject private var appModel: AppModel

    var body: some View {
        NavigationStack {
            HubView()
                .navigationTitle("Atoms Capture")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            appModel.showCapture = true
                        } label: {
                            Label("Capture", systemImage: "plus.circle.fill")
                        }
                        .tint(AtomsTheme.tint)
                    }
                }
        }
        .sheet(isPresented: $appModel.showCapture) {
            CaptureSheet()
                .environmentObject(appModel)
        }
    }
}
