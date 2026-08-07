import SwiftUI
import UniformTypeIdentifiers
import AtomsCaptureCore

struct HubView: View {
    @EnvironmentObject private var appModel: AppModel
    @State private var showImporter = false
    @State private var testStatus: String?
    @State private var testBusy = false

    var body: some View {
        List {
            Section {
                HStack(spacing: 12) {
                    Text(AtomsTheme.mark)
                        .font(.system(size: 36, weight: .bold, design: .monospaced))
                        .foregroundStyle(AtomsTheme.tint)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Setup hub")
                            .font(.headline)
                        Text("This hub is for setup. Day to day, don’t open the app — use the widget, Action Button, or App Intent.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
            }

            Section("Vault") {
                if appModel.store.isLinked {
                    LabeledContent("Linked") {
                        Text(appModel.store.displayName ?? "Vault")
                            .foregroundStyle(.secondary)
                    }
                    if let hint = appModel.store.pathHint {
                        Text(hint)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Text("Captures go to \(CaptureLine.inboxRelativePath)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Text("No vault linked yet.")
                        .foregroundStyle(.secondary)
                }

                Button("Link vault folder…") {
                    showImporter = true
                }

                if appModel.store.isLinked {
                    Button("Unlink vault", role: .destructive) {
                        appModel.store.clear()
                        testStatus = nil
                        appModel.refreshStatus()
                    }
                }

                Text("Use a Files-visible vault (iCloud Drive, On My iPhone, or another Files provider). Obsidian Sync’s private sandbox often isn’t writable here — that needs Plus later.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Test capture") {
                Button {
                    runTestCapture()
                } label: {
                    if testBusy {
                        ProgressView()
                    } else {
                        Text("Save test capture")
                    }
                }
                .disabled(testBusy)

                if let testStatus {
                    Text(testStatus)
                        .font(.subheadline)
                        .foregroundStyle(testStatus.hasPrefix("In vault") ? .green : .orange)
                }
            }

            Section("Checklist") {
                checklistRow(done: appModel.store.isLinked, title: "1. Link a Files-visible vault")
                checklistRow(done: testStatus?.hasPrefix("In vault") == true, title: "2. Save a test capture")
                checklistRow(done: false, title: "3. Add the Home Screen widget")
                checklistRow(done: false, title: "4. Add Capture to Action Button (optional)")
                Text("Long-press Home → Widgets → Atoms Capture. For Action Button: Settings → Action Button → Shortcut → Atoms Capture.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .fileImporter(
            isPresented: $showImporter,
            allowedContentTypes: [.folder],
            allowsMultipleSelection: false
        ) { result in
            handleImport(result)
        }
    }

    private func checklistRow(done: Bool, title: String) -> some View {
        Label {
            Text(title)
        } icon: {
            Image(systemName: done ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(done ? AtomsTheme.tint : .secondary)
        }
    }

    private func handleImport(_ result: Result<[URL], Error>) {
        switch result {
        case .failure(let error):
            testStatus = "Failed: \(error.localizedDescription)"
        case .success(let urls):
            guard let url = urls.first else { return }
            let access = url.startAccessingSecurityScopedResource()
            defer {
                if access { url.stopAccessingSecurityScopedResource() }
            }
            do {
                let data = try VaultStore.makeBookmarkData(from: url)
                let name = url.lastPathComponent
                appModel.store.saveBookmark(
                    data: data,
                    displayName: name,
                    pathHint: url.path
                )
                testStatus = nil
                appModel.refreshStatus()
            } catch {
                testStatus = "Failed: could not save vault link — \(error.localizedDescription)"
            }
        }
    }

    private func runTestCapture() {
        testBusy = true
        defer { testBusy = false }
        let stamp = ISO8601DateFormatter().string(from: Date())
        let body = "Atoms Capture test \(stamp)"
        let status = appModel.repository.capture(body: body)
        switch status {
        case .inVault:
            testStatus = "In vault — check \(CaptureLine.inboxRelativePath)"
        case .failed(let reason):
            testStatus = "Failed: \(reason)"
        }
    }
}
