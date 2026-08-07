import SwiftUI
import AtomsCaptureCore

struct CaptureSheet: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss

    @StateObject private var speech = SpeechSession()
    @State private var text = ""
    @State private var status: DeliveryStatus?
    @State private var busy = false
    @State private var activity: CaptureActivityController?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                TextField("What’s on your mind?", text: $text, axis: .vertical)
                    .lineLimit(4...12)
                    .padding(12)
                    .background(AtomsTheme.card.opacity(0.35))
                    .clipShape(RoundedRectangle(cornerRadius: 12))

                HStack(spacing: 12) {
                    Button {
                        toggleListen()
                    } label: {
                        Label(
                            speech.isListening ? "Stop" : "Listen",
                            systemImage: speech.isListening ? "stop.circle.fill" : "mic.circle.fill"
                        )
                    }
                    .buttonStyle(.bordered)
                    .tint(speech.isListening ? .orange : AtomsTheme.tint)

                    Spacer()

                    Button {
                        save()
                    } label: {
                        if busy {
                            ProgressView()
                        } else {
                            Text("Save")
                                .fontWeight(.semibold)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(AtomsTheme.tint)
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy)
                }

                if let err = speech.lastError {
                    Text(err)
                        .font(.caption)
                        .foregroundStyle(.orange)
                }

                if let status {
                    Text(statusLabel(status))
                        .font(.subheadline)
                        .foregroundStyle(status == .inVault ? .green : .orange)
                }

                Spacer()
            }
            .padding()
            .navigationTitle("Capture")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        speech.stop()
                        activity?.end()
                        dismiss()
                    }
                }
            }
            .onChange(of: speech.liveText) { _, newValue in
                if speech.isListening {
                    text = newValue
                    activity?.update(phase: .listening, preview: newValue)
                }
            }
            .onDisappear {
                speech.stop()
                activity?.end()
                activity = nil
            }
        }
    }

    private func toggleListen() {
        if speech.isListening {
            speech.stop()
            activity?.end()
            activity = nil
        } else {
            if activity == nil {
                activity = CaptureActivityController()
            }
            // Field is SSOT — seed speech so Listen does not wipe typed text.
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
            let result = await Task.detached {
                repo.capture(body: body)
            }.value
            status = result
            busy = false
            switch result {
            case .inVault:
                activity?.update(phase: .inVault, preview: body)
                text = ""
                try? await Task.sleep(nanoseconds: 800_000_000)
                activity?.end()
                activity = nil
                dismiss()
            case .failed:
                activity?.update(phase: .failed, preview: body)
            }
        }
    }

    private func statusLabel(_ status: DeliveryStatus) -> String {
        switch status {
        case .inVault:
            return "In vault"
        case .failed(let reason):
            return "Failed: \(reason)"
        }
    }
}
