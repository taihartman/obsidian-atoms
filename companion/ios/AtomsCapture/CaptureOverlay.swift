import SwiftUI
import AtomsCaptureCore

/// Floating top strip — visual parity with Android QuickCaptureScreen / overlay service.
/// Note: iOS cannot draw over *other* apps (no SYSTEM_ALERT_WINDOW). Widget / Control Center
/// / Action Button open *this* strip instead of the hub.
struct CaptureOverlay: View {
    @EnvironmentObject private var appModel: AppModel
    @FocusState private var focused: Bool

    @StateObject private var speech = SpeechSession()
    @State private var text = ""
    @State private var status: DeliveryStatus?
    @State private var busy = false
    @State private var activity: CaptureActivityController?

    var body: some View {
        ZStack(alignment: .top) {
            // Dim scrim (Android shows wallpaper/apps behind true overlay; we approximate)
            Color.black.opacity(0.45)
                .ignoresSafeArea()
                .onTapGesture {
                    // Don't dismiss on scrim tap while typing — only X / success
                }

            VStack(spacing: 0) {
                strip
                    .padding(.horizontal, 12)
                    .padding(.top, 10)
                Spacer()
            }
        }
        .onAppear {
            focused = true
        }
        .onChange(of: speech.liveText) { _, newValue in
            if speech.isListening {
                text = newValue
                activity?.update(phase: .listening, preview: newValue)
            }
        }
        .onChange(of: speech.isListening) { _, listening in
            focused = !listening
        }
        .onDisappear {
            teardown()
        }
    }

    private var strip: some View {
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
                Spacer(minLength: 8)
                Button {
                    close()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(AtomsTheme.secondary)
                        .frame(width: 36, height: 36)
                        .background(AtomsTheme.elevated)
                        .clipShape(Circle())
                }
            }

            TextField("Type freely…", text: $text, axis: .vertical)
                .lineLimit(2...6)
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
                    Group {
                        if busy {
                            ProgressView().tint(.white)
                        } else {
                            Image(systemName: "checkmark")
                                .font(.system(size: 20, weight: .bold))
                                .foregroundStyle(.white)
                        }
                    }
                    .frame(width: 48, height: 48)
                    .background(
                        text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy
                            ? AtomsTheme.tint.opacity(0.35)
                            : AtomsTheme.tint
                    )
                    .clipShape(Circle())
                }
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
        .shadow(color: .black.opacity(0.4), radius: 20, y: 10)
    }

    private var titleText: String {
        if speech.isListening { return "Listening…" }
        return "What’s on your mind?"
    }

    private var subtitleText: String {
        if appModel.delivery.mode == .files, let name = appModel.store.displayName {
            return name
        }
        return "Atoms Inbox"
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
                try? await Task.sleep(nanoseconds: 450_000_000)
                close()
            case .failed:
                activity?.update(phase: .failed, preview: body)
            }
        }
    }

    private func close() {
        teardown()
        appModel.dismissQuickCapture()
        // If we were opened from widget/CC, suspend so user returns to previous app.
        // (Can't stay as true overlay; best iOS can do.)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            // UIApplication.shared.perform(#selector(NSXPCConnection.suspend)) is private;
            // moving to background isn't public. User taps home or we leave hub underneath.
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
        case .failed(let reason): return reason
        }
    }
}
