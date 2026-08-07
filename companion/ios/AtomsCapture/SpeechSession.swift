import Foundation
import Speech
import AVFoundation

/// Live partials into a field; stop keeps what is already shown (Android parity).
@MainActor
final class SpeechSession: ObservableObject {
    @Published var liveText = ""
    @Published var isListening = false
    @Published var lastError: String?

    private let audioEngine = AVAudioEngine()
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var sessionGeneration = 0
    private var baseText = ""

    func start() {
        lastError = nil
        sessionGeneration += 1
        let generation = sessionGeneration
        baseText = liveText

        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            Task { @MainActor in
                guard let self else { return }
                guard generation == self.sessionGeneration else { return }
                guard status == .authorized else {
                    self.lastError = "Speech recognition not authorized."
                    return
                }
                self.beginListening(generation: generation)
            }
        }
    }

    func stop() {
        sessionGeneration += 1
        request?.endAudio()
        task?.cancel()
        task = nil
        request = nil
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        isListening = false
    }

    private func beginListening(generation: Int) {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            lastError = "Microphone unavailable: \(error.localizedDescription)"
            return
        }

        let recognizer = SFSpeechRecognizer()
        self.recognizer = recognizer
        guard let recognizer, recognizer.isAvailable else {
            lastError = "Speech recognizer unavailable."
            return
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }
        self.request = request

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
        }

        do {
            audioEngine.prepare()
            try audioEngine.start()
        } catch {
            lastError = "Could not start audio: \(error.localizedDescription)"
            return
        }

        isListening = true
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor in
                guard let self else { return }
                guard generation == self.sessionGeneration else { return }
                if let result {
                    let spoken = result.bestTranscription.formattedString
                    if self.baseText.isEmpty {
                        self.liveText = spoken
                    } else if spoken.isEmpty {
                        self.liveText = self.baseText
                    } else {
                        self.liveText = self.baseText.trimmingCharacters(in: .whitespacesAndNewlines)
                            + (self.baseText.hasSuffix(" ") || self.baseText.isEmpty ? "" : " ")
                            + spoken
                    }
                }
                if let error, !Self.isSoft(error) {
                    self.lastError = error.localizedDescription
                    self.stop()
                }
            }
        }
    }

    private static func isSoft(_ error: Error) -> Bool {
        let ns = error as NSError
        // Cancellation / no-match style codes often fire on stop.
        return ns.domain == "kAFAssistantErrorDomain" || ns.code == 1 || ns.code == 203 || ns.code == 216
    }
}
