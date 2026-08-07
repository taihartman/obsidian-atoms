import SwiftUI
import UniformTypeIdentifiers
import WidgetKit
import UIKit
import AtomsCaptureCore

/// Hub layout mirrored from Android CaptureScreen (docs/qa/screenshots/android-capture-poc/01-launch.png).
struct HubView: View {
    @EnvironmentObject private var appModel: AppModel
    @State private var showImporter = false
    @State private var draft = ""
    @State private var banner: String?
    @State private var bannerIsError = false
    @State private var busy = false
    @State private var firstCaptureDone = false
    @State private var showAdvanced = false

    private var isSyncMode: Bool {
        appModel.delivery.mode != .files
    }

    private var setupReady: Bool {
        if isSyncMode {
            return appModel.delivery.shortcutReadyAcknowledged
        }
        return appModel.store.isLinked
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                // Top bar title block (no +)
                VStack(alignment: .leading, spacing: 2) {
                    Text("CAPTURE")
                        .font(AtomsTheme.kicker)
                        .foregroundStyle(AtomsTheme.mind)
                    Text("Atoms")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(AtomsTheme.label)
                }
                .padding(.top, 12)

                Text("“What’s on your mind?”")
                    .font(AtomsTheme.claim)
                    .foregroundStyle(AtomsTheme.label)
                    .padding(.top, 4)

                Text("A thought lands in your vault. Atoms files it later.")
                    .font(.subheadline)
                    .foregroundStyle(AtomsTheme.secondary)

                setupChecklistCard

                if setupReady {
                    captureFasterCard
                }

                if let banner {
                    statusBanner(banner, isError: bannerIsError)
                }

                // VAULT / SYNC chooser — Android VaultChooserCard shape
                vaultOrSyncCard

                // Draft field
                TextField("Type freely…", text: $draft, axis: .vertical)
                    .lineLimit(5...10)
                    .padding(14)
                    .font(.body)
                    .foregroundStyle(AtomsTheme.label)
                    .background(AtomsTheme.card)
                    .overlay(
                        RoundedRectangle(cornerRadius: AtomsTheme.fieldRadius, style: .continuous)
                            .stroke(AtomsTheme.hairline, lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: AtomsTheme.fieldRadius, style: .continuous))
                    .disabled(busy)

                Button {
                    captureDraft()
                } label: {
                    if busy {
                        ProgressView().tint(.white)
                    } else {
                        Text("Capture")
                    }
                }
                .buttonStyle(AtomsPrimaryButtonStyle(enabled: canCapture))
                .disabled(!canCapture)

                Text(
                    "With Obsidian closed, the line is on this device immediately. It reaches your other devices after you open Obsidian."
                )
                .font(.caption)
                .foregroundStyle(AtomsTheme.tertiary)
                .padding(.bottom, 32)
            }
            .padding(.horizontal, 16)
        }
        .background(AtomsTheme.bg.ignoresSafeArea())
        .fileImporter(
            isPresented: $showImporter,
            allowedContentTypes: [.folder],
            allowsMultipleSelection: false
        ) { handleImport($0) }
    }

    private var canCapture: Bool {
        !busy
            && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && setupReady
    }

    // MARK: GET ATOMS GOING

    private var setupChecklistCard: some View {
        AtomsFlatCard {
            VStack(alignment: .leading, spacing: 14) {
                Text("GET ATOMS GOING")
                    .font(AtomsTheme.kicker)
                    .foregroundStyle(AtomsTheme.mind)

                if isSyncMode {
                    checklistRow(
                        done: appModel.delivery.shortcutReadyAcknowledged,
                        label: "Connect Obsidian Sync",
                        detail: appModel.delivery.shortcutReadyAcknowledged
                            ? "Atoms Capture Append installed"
                            : "Install the Atoms Capture Append shortcut below"
                    )
                } else {
                    checklistRow(
                        done: appModel.store.isLinked,
                        label: "Choose your vault",
                        detail: appModel.store.isLinked
                            ? (appModel.store.displayName ?? "Linked")
                            : "We’ll use a folder you pick in Files"
                    )
                }

                checklistRow(
                    done: firstCaptureDone,
                    label: "Save a first capture",
                    detail: "Try the box below once — then switch to one-tap"
                )
                checklistRow(
                    done: false,
                    label: "Add Action Button (optional)",
                    detail: "Settings → Action Button → Capture thought"
                )
                checklistRow(
                    done: false,
                    label: "Add the home widget",
                    detail: "One tap on the home screen opens capture"
                )
            }
        }
    }

    private func checklistRow(done: Bool, label: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: done ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 22))
                .foregroundStyle(done ? AtomsTheme.done : AtomsTheme.tertiary)
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.body.weight(.medium))
                    .foregroundStyle(AtomsTheme.label)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(AtomsTheme.secondary)
            }
        }
    }

    // MARK: CAPTURE IN ONE SECOND

    private var captureFasterCard: some View {
        AtomsFlatCard {
            VStack(alignment: .leading, spacing: 12) {
                Text("CAPTURE IN ONE SECOND")
                    .font(AtomsTheme.kicker)
                    .foregroundStyle(AtomsTheme.mind)

                Text("This hub is for setup. Day to day, don’t open the app — use these:")
                    .font(.subheadline)
                    .foregroundStyle(AtomsTheme.secondary)

                Text("1. Action Button")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AtomsTheme.label)
                Text("Settings → Action Button → Shortcut → Capture thought.")
                    .font(.caption)
                    .foregroundStyle(AtomsTheme.secondary)

                Text("2. Home widget")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AtomsTheme.label)
                Text("Long-press home → Widgets → Atoms Capture.")
                    .font(.caption)
                    .foregroundStyle(AtomsTheme.secondary)

                Text("Also works: Siri — “Capture with Atoms Capture”")
                    .font(.caption)
                    .foregroundStyle(AtomsTheme.tertiary)

                Button {
                    appModel.presentQuickCapture()
                } label: {
                    Text("Try capture strip")
                }
                .buttonStyle(AtomsPrimaryButtonStyle())
            }
        }
    }

    // MARK: VAULT / SYNC chooser (Android VaultChooserCard)

    private var vaultOrSyncCard: some View {
        AtomsFlatCard {
            VStack(alignment: .leading, spacing: 12) {
                Text(isSyncMode ? "OBSIDIAN SYNC" : "VAULT")
                    .font(AtomsTheme.kicker)
                    .foregroundStyle(AtomsTheme.mind)

                Text(vaultTitle)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(AtomsTheme.label)

                Text(vaultSubtitle)
                    .font(.caption)
                    .foregroundStyle(AtomsTheme.secondary)

                if isSyncMode {
                    // Clear path for Sync users
                    Button {
                        if let url = URL(string: "obsidian://open") {
                            UIApplication.shared.open(url)
                        }
                    } label: {
                        Text("1. Open Obsidian once")
                    }
                    .buttonStyle(AtomsSecondaryButtonStyle())

                    Button {
                        if let url = URL(string: DeliverySettings.appendShortcutICloudURL) {
                            UIApplication.shared.open(url)
                        }
                    } label: {
                        Text("2. Install Atoms Capture Append")
                    }
                    .buttonStyle(AtomsPrimaryButtonStyle())

                    if appModel.delivery.shortcutReadyAcknowledged {
                        Text("Connected · captures go to Atoms System/Inbox.md")
                            .font(.caption)
                            .foregroundStyle(AtomsTheme.done)
                        Button("Mark as not installed") {
                            appModel.delivery.shortcutReadyAcknowledged = false
                            appModel.refreshStatus()
                        }
                        .font(.caption)
                        .foregroundStyle(AtomsTheme.secondary)
                    } else {
                        Button {
                            appModel.delivery.shortcutReadyAcknowledged = true
                            appModel.refreshStatus()
                            banner = "Ready — type below and tap Capture"
                            bannerIsError = false
                        } label: {
                            Text("3. I’ve installed it — continue")
                        }
                        .buttonStyle(AtomsOutlineButtonStyle())
                    }
                } else {
                    // Files vault path
                    if appModel.store.isLinked {
                        Text("Captures go to Atoms System/Inbox.md")
                            .font(.caption)
                            .foregroundStyle(AtomsTheme.secondary)
                        HStack(spacing: 16) {
                            Button("Switch") { showImporter = true }
                                .font(.subheadline)
                                .foregroundStyle(AtomsTheme.secondary)
                            Button("Unlink", role: .destructive) {
                                appModel.store.clear()
                                appModel.refreshStatus()
                                WidgetCenter.shared.reloadAllTimelines()
                            }
                            .font(.subheadline)
                        }
                    } else {
                        Button { showImporter = true } label: {
                            Text("Choose vault folder")
                        }
                        .buttonStyle(AtomsPrimaryButtonStyle())
                        Text("Pick the vault folder in Files (the one that contains your notes).")
                            .font(.caption)
                            .foregroundStyle(AtomsTheme.tertiary)
                    }
                }

                Button {
                    showAdvanced.toggle()
                } label: {
                    Text(showAdvanced ? "Hide advanced" : "Use a Files folder instead…")
                        .font(.caption)
                        .foregroundStyle(AtomsTheme.tertiary)
                }

                if showAdvanced {
                    Picker("Delivery", selection: deliveryModeBinding) {
                        Text("Obsidian Sync (recommended)").tag(DeliveryMode.syncShortcut)
                        Text("Files folder").tag(DeliveryMode.files)
                        Text("Auto").tag(DeliveryMode.auto)
                    }
                    .pickerStyle(.inline)
                    .tint(AtomsTheme.tint)
                }
            }
        }
    }

    private var vaultTitle: String {
        if isSyncMode {
            return appModel.delivery.shortcutReadyAcknowledged
                ? "Connected to Sync"
                : "Connect your Sync vault"
        }
        if appModel.store.isLinked {
            return appModel.store.displayName ?? "Linked"
        }
        return "Choose a vault"
    }

    private var vaultSubtitle: String {
        if isSyncMode {
            return "iOS can’t write into Obsidian’s private Sync folder directly. Append Atom is a one-tap install that only appends — this app still does type and voice."
        }
        return "Link a vault folder visible in the Files app."
    }

    private func statusBanner(_ message: String, isError: Bool) -> some View {
        HStack(alignment: .top) {
            Text(message)
                .font(.subheadline)
                .foregroundStyle(isError ? AtomsTheme.error : AtomsTheme.done)
            Spacer()
            Button("Dismiss") { banner = nil }
                .font(.caption)
                .foregroundStyle(AtomsTheme.secondary)
        }
        .padding(12)
        .background((isError ? AtomsTheme.error : AtomsTheme.done).opacity(0.12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke((isError ? AtomsTheme.error : AtomsTheme.done).opacity(0.32), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12))
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

    private func captureDraft() {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        busy = true
        banner = nil
        let repo = appModel.repository
        Task {
            let status = await Task.detached { repo.capture(body: body) }.value
            busy = false
            switch status {
            case .inVault:
                banner = "In vault"
                bannerIsError = false
                draft = ""
                firstCaptureDone = true
            case .handedToShortcut:
                banner = "Saved · check Atoms System/Inbox.md in Obsidian"
                bannerIsError = false
                draft = ""
                firstCaptureDone = true
            case .failed(let reason):
                banner = reason
                bannerIsError = true
            }
        }
    }

    private func handleImport(_ result: Result<[URL], Error>) {
        switch result {
        case .failure(let error):
            banner = error.localizedDescription
            bannerIsError = true
        case .success(let urls):
            guard let url = urls.first else { return }
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            do {
                let data = try VaultStore.makeBookmarkData(from: url)
                appModel.store.saveBookmark(
                    data: data,
                    displayName: url.lastPathComponent,
                    pathHint: url.path
                )
                appModel.delivery.mode = .files
                appModel.refreshStatus()
                WidgetCenter.shared.reloadAllTimelines()
                banner = "Linked \(url.lastPathComponent)"
                bannerIsError = false
            } catch {
                banner = error.localizedDescription
                bannerIsError = true
            }
        }
    }
}
