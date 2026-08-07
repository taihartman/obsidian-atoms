package app.tryatoms.capture.speech

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import java.util.Locale

/**
 * In-process speech — no full-screen system voice UI.
 * Streams partials into [onPartial]; final into [onFinal].
 */
class InAppSpeech(
    context: Context,
    private val onPartial: (String) -> Unit,
    private val onFinal: (String) -> Unit,
    private val onListening: (Boolean) -> Unit,
    private val onError: (String) -> Unit,
) {
    private val app = context.applicationContext
    private var recognizer: SpeechRecognizer? = null
    private var baseText: String = ""

    val isAvailable: Boolean
        get() = SpeechRecognizer.isRecognitionAvailable(app)

    fun start(existingText: String) {
        if (!isAvailable) {
            onError("Voice not available on this device")
            return
        }
        stop()
        baseText = existingText.trimEnd()
        val r = SpeechRecognizer.createSpeechRecognizer(app)
        recognizer = r
        r.setRecognitionListener(
            object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    onListening(true)
                }

                override fun onBeginningOfSpeech() {}

                override fun onRmsChanged(rmsdB: Float) {}

                override fun onBufferReceived(buffer: ByteArray?) {}

                override fun onEndOfSpeech() {
                    onListening(false)
                }

                override fun onError(error: Int) {
                    onListening(false)
                    if (error == SpeechRecognizer.ERROR_CLIENT ||
                        error == SpeechRecognizer.ERROR_NO_MATCH
                    ) {
                        // user cancelled / silence — quiet
                        return
                    }
                    onError(errorLabel(error))
                }

                override fun onResults(results: Bundle?) {
                    onListening(false)
                    val text =
                        results
                            ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                            ?.firstOrNull()
                            ?.trim()
                    if (!text.isNullOrEmpty()) {
                        onFinal(merge(baseText, text))
                    }
                }

                override fun onPartialResults(partialResults: Bundle?) {
                    val text =
                        partialResults
                            ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                            ?.firstOrNull()
                            ?.trim()
                    if (!text.isNullOrEmpty()) {
                        onPartial(merge(baseText, text))
                    }
                }

                override fun onEvent(
                    eventType: Int,
                    params: Bundle?,
                ) {}
            },
        )

        val intent =
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
                )
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                // Prefer on-device when available (no big UI either way with SpeechRecognizer)
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            }
        try {
            r.startListening(intent)
        } catch (e: Exception) {
            onListening(false)
            onError(e.message ?: "Could not start voice")
        }
    }

    fun stop() {
        try {
            recognizer?.stopListening()
        } catch (_: Exception) {
        }
        try {
            recognizer?.cancel()
        } catch (_: Exception) {
        }
        try {
            recognizer?.destroy()
        } catch (_: Exception) {
        }
        recognizer = null
        onListening(false)
    }

    private fun merge(
        base: String,
        spoken: String,
    ): String =
        if (base.isBlank()) {
            spoken
        } else {
            "$base $spoken"
        }

    private fun errorLabel(code: Int): String =
        when (code) {
            SpeechRecognizer.ERROR_AUDIO -> "Mic error"
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Mic permission needed"
            SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
                "Network needed for voice"
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Didn’t catch that"
            else -> "Voice failed"
        }
}
