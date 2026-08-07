import SwiftUI
import AtomsCaptureCore

/// Quick-capture surface — parity with Android QuickCaptureScreen strip.
struct CaptureSheet: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool

    @StateObject private var speech = SpeechSession()
    @State private var text = ""
    @State private var status: DeliveryStatus?
    @State private var busy = false
    @State private var activity: CaptureActivityController?

    private var ready: Bool {
        appModel.delivery.mode == .files
            ? appModel.store.isLinked
            : appModel.delivery.shortcutReadyAcknowledged || true // allow try; fail honestly
    }

    var body: some View {
        VStack(spacing: 0) {
            // Floating dark card
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(titleText)
                            .font(.system(size: 18, weight: .regular, design: .serif))
                            .foregroundStyle(AtomsTheme.label)
                        if !speech.isListening {
                            Text(subtitleText)
                                .font(.caption)
                                .foregroundStyle(AtomsTheme.tertiary)
                        }
                    }
                    Spacer()
                    Button {
                        teardown()
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(AtomsTheme.secondary)
                            .frame(width: 36, height: 36)
                            .background(AtomsTheme.elevated)
                            .clipShape(Circle())
                    }
                }

                TextField("Type freely…", text: $text, axis: .vertical)
                    .lineLimit(3...8)
                    .font(.body)
                    .foregroundStyle(AtomsTheme.label)
                    .focused($focused)
                    .padding(12)
                    .background(AtomsTheme.elevated)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .disabled(busy)

                HStack(spacing: 10) {
                    Button {
                        toggleListen()
                    } label: {
                        Image(systemName: speech.isListening ? "stop.fill" : "mic.fill")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(speech.isListening ? AtomsTheme.person : AtomsTheme.label)
                            .frame(width: 48, height: 48)
                            .background(AtomsTheme.elevated)
                            .clipShape(Circle())
                    }
                    .disabled(busy)

                    Button {
                        save()
                    } label: {
                        if busy {
                            ProgressView().tint(.white)
                                .frame(maxWidth: .infinity)
                                .frame(height: 48)
                        } else {
                            Label("Capture", systemImage: "checkmark")
                                .frame(maxWidth: .infinity)
                                .frame(height: 48)
                        }
                    }
                    .buttonStyle(AtomsPrimaryButtonStyle(
                        enabled: !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !busy
                    ))
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy)
                }

                if let err = speech.lastError {
                    Text(err)
                        .font(.caption)
                        .foregroundStyle(AtomsTheme.error)
                }
                if let status {
                    Text(statusLabel(status))
                        .font(.caption)
                        .foregroundStyle(status.isSuccess ? AtomsTheme.done : AtomsTheme.error)
                }
            }
            .padding(16)
            .background(AtomsTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .shadow(color: .black.opacity(0.45), radius: 24, y: 8)
            .padding(.horizontal, 12)
            .padding(.top, 8)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.primary.opacity(0.35).ignoresSafeArea())
        .onAppear { focused = true }
        .onChange(of: speech.liveText) { _, newValue in
            if speech.isListening {
                text = newValue
                activity?.update(phase: .listening, preview: newValue)
            }
        }
        .onChange(of: speech.isListening) { _, listening in
            if listening {
                focused = false
            } else {
                focused = true
            }
        }
        .onDisappear { teardown() }
    }

    private var titleText: String {
        if speech.isListening { return "Listening…" }
        return "What’s on your mind?"
    }

    private var subtitleText: String {
        if appModel.delivery.mode == .files, let name = appModel.store.displayName {
            return name
        }
        return "Atoms Inbox · Sync"
    }

    private func toggleListen() {
        if speech.isListening {
            speech.stop()
            activity?.end()
            activity = nil
        } else {
            if activity == nil { activity = CaptureActivityController() }
            speech.liveText = text
            activity?.start(preview: text)
            speech.start()
            activity?.update(phase: .listening, preview: text)
        }
    }

    private func save() {
        busy = true
        speech.stop()
        activity?.update(phase: .saving, preview: text)
        let body = text
        let repo = appModel.repository
        Task {
            let result = await Task.detached { repo.capture(body: body) }.value
            status = result
            busy = false
            switch result {
            case .inVault, .handedToShortcut:
                activity?.update(phase: .inVault, preview: body)
                text = ""
                try? await Task.sleep(nanoseconds: 700_000_000)
                teardown()
                dismiss()
            case .failed:
                activity?.update(phase: .failed, preview: body)
            }
        }
    }

    private func teardown() {
        speech.stop()
        activity?.end()
        activity = nil
    }

    private func statusLabel(_ status: DeliveryStatus) -> String {
        switch status {
        case .inVault: return "In vault"
        case .handedToShortcut: return "Handed to Shortcut"
        case .failed(let reason): return "Failed: \(reason)"
        }
    }
}
