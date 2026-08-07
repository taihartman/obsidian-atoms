package app.tryatoms.capture.speech

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import java.util.Locale

/**
 * In-process speech (no full-screen system voice UI).
 * Must be started/stopped on the main thread.
 */
class InAppSpeech(
    context: Context,
    private val onPartial: (String) -> Unit,
    private val onFinal: (String) -> Unit,
    private val onListening: (Boolean) -> Unit,
    private val onError: (String) -> Unit,
) {
    private val app = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var baseText: String = ""
    private var active = false

    val isAvailable: Boolean
        get() = SpeechRecognizer.isRecognitionAvailable(app)

    fun start(existingText: String) {
        main.post {
            if (!isAvailable) {
                onError("Voice not available on this device")
                return@post
            }
            stopInternal()
            baseText = existingText.trimEnd()
            active = true

            val r =
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        // Prefer on-device when the OEM ships it
                        try {
                            SpeechRecognizer.createOnDeviceSpeechRecognizer(app)
                        } catch (_: Exception) {
                            SpeechRecognizer.createSpeechRecognizer(app)
                        }
                    } else {
                        SpeechRecognizer.createSpeechRecognizer(app)
                    }
                } catch (e: Exception) {
                    onError("Could not start mic: ${e.message}")
                    active = false
                    return@post
                }

            recognizer = r
            r.setRecognitionListener(listener())

            val intent =
                Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(
                        RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                        RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
                    )
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
                    putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, app.packageName)
                    // Do NOT force offline — many phones have no offline model and fail quietly
                }

            try {
                onListening(true)
                r.startListening(intent)
                Log.i(TAG, "startListening ok")
            } catch (e: Exception) {
                Log.e(TAG, "startListening failed", e)
                onListening(false)
                active = false
                onError(e.message ?: "Could not start voice")
            }
        }
    }

    fun stop() {
        main.post { stopInternal() }
    }

    private fun stopInternal() {
        active = false
        val r = recognizer
        recognizer = null
        if (r != null) {
            try {
                r.stopListening()
            } catch (_: Exception) {
            }
            try {
                r.cancel()
            } catch (_: Exception) {
            }
            try {
                r.destroy()
            } catch (_: Exception) {
            }
        }
        onListening(false)
    }

    private fun listener(): RecognitionListener =
        object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {
                Log.i(TAG, "onReadyForSpeech")
                onListening(true)
            }

            override fun onBeginningOfSpeech() {
                Log.i(TAG, "onBeginningOfSpeech")
            }

            override fun onRmsChanged(rmsdB: Float) {}

            override fun onBufferReceived(buffer: ByteArray?) {}

            override fun onEndOfSpeech() {
                Log.i(TAG, "onEndOfSpeech")
            }

            override fun onError(error: Int) {
                Log.w(TAG, "onError code=$error active=$active")
                if (!active) return
                active = false
                onListening(false)
                // Always surface — silent failures felt like “voice doesn’t work”
                when (error) {
                    SpeechRecognizer.ERROR_NO_MATCH,
                    SpeechRecognizer.ERROR_SPEECH_TIMEOUT,
                    -> onError("Didn’t catch that — try again")
                    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> onError("Mic busy — tap again")
                    SpeechRecognizer.ERROR_CLIENT -> {
                        // Often fires on cancel; if we were active, tell the user
                        onError("Voice stopped — tap mic again")
                    }
                    else -> onError(errorLabel(error))
                }
                destroyRecognizerOnly()
            }

            override fun onResults(results: Bundle?) {
                Log.i(TAG, "onResults")
                if (!active) return
                active = false
                onListening(false)
                val text =
                    results
                        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()
                        ?.trim()
                if (!text.isNullOrEmpty()) {
                    onFinal(merge(baseText, text))
                } else {
                    onError("Didn’t catch that — try again")
                }
                destroyRecognizerOnly()
            }

            override fun onPartialResults(partialResults: Bundle?) {
                val text =
                    partialResults
                        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()
                        ?.trim()
                if (!text.isNullOrEmpty() && active) {
                    onPartial(merge(baseText, text))
                }
            }

            override fun onEvent(
                eventType: Int,
                params: Bundle?,
            ) {}
        }

    private fun destroyRecognizerOnly() {
        val r = recognizer
        recognizer = null
        try {
            r?.destroy()
        } catch (_: Exception) {
        }
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
            SpeechRecognizer.ERROR_NETWORK,
            SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
            -> "Network needed for voice"
            SpeechRecognizer.ERROR_SERVER -> "Voice service error"
            SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "Language pack missing"
            else -> "Voice failed ($code)"
        }

    companion object {
        private const val TAG = "AtomsSpeech"
    }
}
