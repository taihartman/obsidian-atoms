import SwiftUI
import UniformTypeIdentifiers
import WidgetKit
import UIKit
import AtomsCaptureCore

/// iOS setup hub only. Day-to-day capture = **Capture Atom** shortcut (system card).
struct HubView: View {
    @EnvironmentObject private var appModel: AppModel
    @State private var showImporter = false
    @State private var banner: String?
    @State private var bannerIsError = false
    @State private var triedCapture = false
    @State private var showFilesAdvanced = false

    private var installed: Bool {
        appModel.delivery.shortcutReadyAcknowledged
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header

                Text("Capture on iPhone uses **Capture Atom** — a system card over whatever you’re doing. This app is only for setup.")
                    .font(.subheadline)
                    .foregroundStyle(AtomsTheme.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                if let banner {
                    statusBanner(banner, isError: bannerIsError)
                }

                setupCard

                if installed {
                    dailyCard
                }

                footerNote
                    .padding(.bottom, 32)
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
        }
        .background(AtomsTheme.bg.ignoresSafeArea())
        .fileImporter(
            isPresented: $showImporter,
            allowedContentTypes: [.folder],
            allowsMultipleSelection: false
        ) { handleImport($0) }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("CAPTURE")
                .font(AtomsTheme.kicker)
                .foregroundStyle(AtomsTheme.mind)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("Atoms")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(AtomsTheme.label)
                Text(AtomsTheme.mark)
                    .font(.title3.monospaced())
                    .foregroundStyle(AtomsTheme.tint)
            }
        }
        .padding(.top, 8)
    }

    // MARK: Setup (once)

    private var setupCard: some View {
        AtomsFlatCard {
            VStack(alignment: .leading, spacing: 14) {
                Text("SETUP (ONCE)")
                    .font(AtomsTheme.kicker)
                    .foregroundStyle(AtomsTheme.mind)

                stepRow(
                    number: "1",
                    done: false,
                    title: "Atoms plugin in Obsidian",
                    detail: "Install Atoms (BRAT: taihartman/obsidian-atoms, or Community Plugins when listed). Open your vault once so it creates Atoms System/Inbox.md and the Atoms Inbox bookmark. Without the plugin, Capture Atom has nowhere safe to append."
                )
                Button {
                    if let url = URL(string: "obsidian://open") {
                        UIApplication.shared.open(url)
                    }
                } label: {
                    Text("Open Obsidian")
                }
                .buttonStyle(AtomsSecondaryButtonStyle())

                Text("In Obsidian: Settings → Community plugins → BRAT → add taihartman/obsidian-atoms (or enable Atoms if already installed).")
                    .font(.caption2)
                    .foregroundStyle(AtomsTheme.tertiary)

                stepRow(
                    number: "2",
                    done: installed,
                    title: "Install Capture Atom",
                    detail: "The shortcut for type/voice into your Sync vault. Name must stay “Capture Atom”."
                )
                Button {
                    if let url = URL(string: DeliverySettings.captureAtomICloudURL) {
                        UIApplication.shared.open(url)
                    }
                } label: {
                    Text(installed ? "Re-install / update Capture Atom" : "Install Capture Atom")
                }
                .buttonStyle(AtomsPrimaryButtonStyle())

                if installed {
                    Text("Installed · ready to capture")
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
                        banner = "Great — try a capture next"
                        bannerIsError = false
                    } label: {
                        Text("I’ve added it in Shortcuts")
                    }
                    .buttonStyle(AtomsOutlineButtonStyle())
                }

                // Files path tucked away — not the default story
                DisclosureGroup(isExpanded: $showFilesAdvanced) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Only if you keep a vault folder in the Files app (not Sync’s private box).")
                            .font(.caption)
                            .foregroundStyle(AtomsTheme.secondary)
                        if appModel.store.isLinked {
                            Text("Linked: \(appModel.store.displayName ?? "vault")")
                                .font(.caption)
                                .foregroundStyle(AtomsTheme.done)
                            HStack {
                                Button("Switch folder") { showImporter = true }
                                Button("Unlink", role: .destructive) {
                                    appModel.store.clear()
                                    appModel.delivery.mode = .syncShortcut
                                    appModel.refreshStatus()
                                    WidgetCenter.shared.reloadAllTimelines()
                                }
                            }
                            .font(.caption)
                        } else {
                            Button("Link Files vault…") {
                                showImporter = true
                            }
                            .buttonStyle(AtomsOutlineButtonStyle())
                        }
                    }
                    .padding(.top, 8)
                } label: {
                    Text("Advanced: Files folder vault")
                        .font(.caption)
                        .foregroundStyle(AtomsTheme.tertiary)
                }
            }
        }
    }

    // MARK: Daily use (after install)

    private var dailyCard: some View {
        AtomsFlatCard {
            VStack(alignment: .leading, spacing: 14) {
                Text("CAPTURE ANYTIME")
                    .font(AtomsTheme.kicker)
                    .foregroundStyle(AtomsTheme.mind)

                Text("Don’t open this app to capture. Use Capture Atom:")
                    .font(.subheadline)
                    .foregroundStyle(AtomsTheme.secondary)

                Button {
                    runCaptureAtom()
                } label: {
                    Text(triedCapture ? "Capture again" : "Try Capture Atom now")
                }
                .buttonStyle(AtomsPrimaryButtonStyle())

                Divider().background(AtomsTheme.hairline)

                pinRow(
                    title: "Action Button",
                    detail: "Settings → Action Button → Shortcut → Capture Atom"
                )
                pinRow(
                    title: "Home Screen widget",
                    detail: "Long-press home → Widgets → Atoms Capture (opens Capture Atom)"
                )
                pinRow(
                    title: "Control Center",
                    detail: "Edit Controls → add Shortcuts → Capture Atom"
                )
                pinRow(
                    title: "Siri",
                    detail: "“Hey Siri, Capture Atom” or run the shortcut by name"
                )

                Text("After you capture, open Obsidian (with Atoms enabled) when you can so Sync and Process can file the line.")
                    .font(.caption)
                    .foregroundStyle(AtomsTheme.tertiary)
                    .padding(.top, 4)
            }
        }
    }

    private var footerNote: some View {
        Text("Captures land in Atoms System/Inbox.md. The Atoms plugin files them into dailies.")
            .font(.caption)
            .foregroundStyle(AtomsTheme.tertiary)
    }

    // MARK: Rows

    private func stepRow(number: String, done: Bool, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle()
                    .fill(done ? AtomsTheme.done.opacity(0.2) : AtomsTheme.elevated)
                    .frame(width: 28, height: 28)
                if done {
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(AtomsTheme.done)
                } else {
                    Text(number)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(AtomsTheme.secondary)
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(AtomsTheme.label)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(AtomsTheme.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func pinRow(title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(AtomsTheme.label)
            Text(detail)
                .font(.caption)
                .foregroundStyle(AtomsTheme.secondary)
        }
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

    // MARK: Actions

    private func runCaptureAtom() {
        let status = appModel.repository.openCaptureAtomUI()
        switch status {
        case .handedToShortcut:
            triedCapture = true
            banner = "Opened Capture Atom — type or speak, then you’re done"
            bannerIsError = false
        case .failed(let reason):
            banner = reason
            bannerIsError = true
        case .inVault:
            break
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
                banner = "Linked \(url.lastPathComponent) — Files mode (advanced)"
                bannerIsError = false
            } catch {
                banner = error.localizedDescription
                bannerIsError = true
            }
        }
    }
}
