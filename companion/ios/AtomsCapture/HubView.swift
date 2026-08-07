import SwiftUI
import UniformTypeIdentifiers
import WidgetKit
import UIKit
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

            Section("Where captures go") {
                Picker("Delivery", selection: deliveryModeBinding) {
                    ForEach(DeliveryMode.allCases, id: \.self) { mode in
                        Text(mode.title).tag(mode)
                    }
                }
                Text(appModel.delivery.mode.blurb)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if appModel.delivery.mode != .files {
                Section("Obsidian Sync setup (once)") {
                    Text("Sync Remote Vault lives inside Obsidian — other apps can’t write it directly. The companion does type/voice/widget; a tiny Shortcut only appends the finished line into Obsidian’s **Atoms Inbox** bookmark.")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    LabeledContent("Shortcut name") {
                        TextField("Name", text: shortcutNameBinding)
                            .multilineTextAlignment(.trailing)
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("In Shortcuts, create **\(appModel.delivery.shortcutName)** with exactly two actions:")
                            .font(.caption)
                        Text("1. **Receive** Text input from Share Sheet / Shortcuts")
                            .font(.caption)
                        Text("2. **Append to Bookmark** (Obsidian) → bookmark **Atoms Inbox** → Text = Shortcut Input")
                            .font(.caption)
                        Text("Open Obsidian once first so Atoms creates `Atoms System/Inbox.md` and the **Atoms Inbox** bookmark.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Button("Open Obsidian (create inbox + bookmark)") {
                        if let url = URL(string: "obsidian://open") {
                            UIApplication.shared.open(url)
                        }
                    }

                    Toggle("I’ve added the Append Shortcut", isOn: shortcutReadyBinding)

                    Text("Optional: install the full **Capture Atom** recipe from the plugin (type/voice without the companion). Companion path does not need that full recipe.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)

                    if let url = URL(string: DeliverySettings.captureAtomICloudURL) {
                        Link("Open Capture Atom iCloud link (optional)", destination: url)
                            .font(.caption)
                    }
                }
            }

            if appModel.delivery.mode != .syncShortcut {
                Section("Files vault (optional)") {
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
                        Text("No Files vault linked.")
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
                            WidgetCenter.shared.reloadAllTimelines()
                        }
                    }

                    Text("Only works for folders visible in Files. Sync Remote Vault is usually not one of them.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
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
                        .foregroundStyle(statusColor(testStatus))
                }
            }

            Section("Checklist") {
                if appModel.delivery.mode != .files {
                    checklistRow(
                        done: appModel.delivery.shortcutReadyAcknowledged,
                        title: "1. Create Append Shortcut + Atoms Inbox bookmark"
                    )
                } else {
                    checklistRow(done: appModel.store.isLinked, title: "1. Link a Files-visible vault")
                }
                checklistRow(
                    done: testStatus.map { $0.hasPrefix("In vault") || $0.hasPrefix("Handed to Shortcut") } ?? false,
                    title: "2. Save a test capture"
                )
                checklistRow(done: false, title: "3. Add the Home Screen widget")
                checklistRow(done: false, title: "4. Add Capture to Action Button (optional)")
                Text("Long-press Home → Widgets → Atoms Capture.")
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

    private var deliveryModeBinding: Binding<DeliveryMode> {
        Binding(
            get: { appModel.delivery.mode },
            set: {
                appModel.delivery.mode = $0
                appModel.refreshStatus()
            }
        )
    }

    private var shortcutNameBinding: Binding<String> {
        Binding(
            get: { appModel.delivery.shortcutName },
            set: { appModel.delivery.shortcutName = $0 }
        )
    }

    private var shortcutReadyBinding: Binding<Bool> {
        Binding(
            get: { appModel.delivery.shortcutReadyAcknowledged },
            set: {
                appModel.delivery.shortcutReadyAcknowledged = $0
                appModel.refreshStatus()
            }
        )
    }

    private func checklistRow(done: Bool, title: String) -> some View {
        Label {
            Text(title)
        } icon: {
            Image(systemName: done ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(done ? AtomsTheme.tint : .secondary)
        }
    }

    private func statusColor(_ text: String) -> Color {
        if text.hasPrefix("In vault") || text.hasPrefix("Handed to Shortcut") {
            return .green
        }
        return .orange
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
                WidgetCenter.shared.reloadAllTimelines()
            } catch {
                testStatus = "Failed: could not save vault link — \(error.localizedDescription)"
            }
        }
    }

    private func runTestCapture() {
        testBusy = true
        let stamp = ISO8601DateFormatter().string(from: Date())
        let body = "Atoms Capture test \(stamp)"
        let repo = appModel.repository
        Task {
            let status = await Task.detached {
                repo.capture(body: body)
            }.value
            testBusy = false
            switch status {
            case .inVault:
                testStatus = "In vault — check \(CaptureLine.inboxRelativePath)"
            case .handedToShortcut:
                testStatus = "Handed to Shortcut — confirm line in Obsidian Inbox"
            case .failed(let reason):
                testStatus = "Failed: \(reason)"
            }
        }
    }
}
