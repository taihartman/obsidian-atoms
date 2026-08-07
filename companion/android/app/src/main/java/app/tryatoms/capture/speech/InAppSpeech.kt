package app.tryatoms.capture.speech

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import java.util.Locale

/**
 * Live dictation into a text field.
 *
 * While the mic is on, partials stream into the box. After each segment the
 * engine auto-restarts until the user hits stop. Transient errors (timeout,
 * network blip, busy) restart silently — they must not kill the session or
 * wipe text already in the live feed.
 */
class InAppSpeech(
    context: Context,
    private val onLiveText: (String) -> Unit,
    private val onListening: (Boolean) -> Unit,
    private val onError: (String) -> Unit,
) {
    private val host = context
    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null

    private var committed: String = ""
    private var partial: String = ""
    private var dictating = false
    private var restartPending = false
    private var consecutiveHardErrors = 0

    val isAvailable: Boolean
        get() = SpeechRecognizer.isRecognitionAvailable(host)

    fun start(existingText: String) {
        main.post {
            if (!isAvailable) {
                onError("Voice not available on this device")
                return@post
            }
            destroyQuietly()
            committed = existingText.trimEnd()
            partial = ""
            dictating = true
            restartPending = false
            consecutiveHardErrors = 0
            onListening(true)
            beginSegment()
        }
    }

    /** End dictation. Keeps whatever was last pushed via [onLiveText]. */
    fun stop() {
        main.post {
            if (!dictating) {
                destroyQuietly()
                onListening(false)
                return@post
            }
            dictating = false
            restartPending = false
            if (partial.isNotBlank()) {
                committed = merge(committed, partial)
                partial = ""
                pushLive()
            }
            destroyQuietly()
            onListening(false)
            Log.i(TAG, "stop — kept live text len=${committed.length}")
        }
    }

    fun stopNow() {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            hardStop()
        } else {
            main.post { hardStop() }
        }
    }

    private fun hardStop() {
        dictating = false
        restartPending = false
        destroyQuietly()
        try {
            onListening(false)
        } catch (_: Exception) {
        }
    }

    private fun beginSegment() {
        if (!dictating) return
        destroyQuietly()
        partial = ""

        val r =
            try {
                SpeechRecognizer.createSpeechRecognizer(host)
            } catch (e: Exception) {
                Log.e(TAG, "create failed", e)
                failOut("Could not start mic: ${e.message}")
                return
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
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, host.packageName)
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 1500L)
                putExtra(
                    RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS,
                    2500L,
                )
                putExtra(
                    RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS,
                    2000L,
                )
            }

        try {
            r.startListening(intent)
            Log.i(TAG, "segment startListening")
        } catch (e: Exception) {
            Log.e(TAG, "startListening failed", e)
            // Treat as restartable unless it keeps happening
            scheduleRestart(delayMs = 500L)
        }
    }

    private fun scheduleRestart(delayMs: Long = 350L) {
        if (!dictating || restartPending) return
        restartPending = true
        main.postDelayed(
            {
                restartPending = false
                if (dictating) beginSegment()
            },
            delayMs,
        )
    }

    private fun commitOpenPartial() {
        if (partial.isNotEmpty()) {
            committed = merge(committed, partial)
            partial = ""
            pushLive()
        }
    }

    private fun pushLive() {
        val live = liveText()
        Log.d(TAG, "live len=${live.length}")
        try {
            onLiveText(live)
        } catch (_: Exception) {
        }
    }

    private fun liveText(): String {
        if (partial.isBlank()) return committed
        return merge(committed, partial)
    }

    private fun failOut(message: String) {
        dictating = false
        restartPending = false
        destroyQuietly()
        onListening(false)
        onError(message)
    }

    private fun destroyQuietly() {
        val r = recognizer
        recognizer = null
        if (r == null) return
        try {
            r.cancel()
        } catch (_: Exception) {
        }
        try {
            r.destroy()
        } catch (_: Exception) {
        }
    }

    private fun listener(): RecognitionListener =
        object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {
                Log.i(TAG, "onReadyForSpeech")
                consecutiveHardErrors = 0
            }

            override fun onBeginningOfSpeech() {
                Log.i(TAG, "onBeginningOfSpeech")
            }

            override fun onRmsChanged(rmsdB: Float) {}

            override fun onBufferReceived(buffer: ByteArray?) {}

            override fun onEndOfSpeech() {
                Log.i(TAG, "onEndOfSpeech")
            }

            override fun onPartialResults(partialResults: Bundle?) {
                if (!dictating) return
                val text =
                    partialResults
                        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()
                        ?.trim()
                        .orEmpty()
                if (text.isEmpty()) return
                partial = text
                pushLive()
            }

            override fun onResults(results: Bundle?) {
                if (!dictating) {
                    destroyQuietly()
                    return
                }
                consecutiveHardErrors = 0
                val text =
                    results
                        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()
                        ?.trim()
                        .orEmpty()
                Log.i(TAG, "onResults segment len=${text.length}")
                if (text.isNotEmpty()) {
                    committed = merge(committed, text)
                    partial = ""
                    pushLive()
                } else {
                    commitOpenPartial()
                }
                scheduleRestart()
            }

            override fun onError(error: Int) {
                Log.w(TAG, "onError code=$error dictating=$dictating hard=$consecutiveHardErrors")
                if (!dictating) {
                    destroyQuietly()
                    return
                }
                commitOpenPartial()

                // Soft / expected segment ends — always keep going, no UI error
                when (error) {
                    SpeechRecognizer.ERROR_NO_MATCH,
                    SpeechRecognizer.ERROR_SPEECH_TIMEOUT,
                    SpeechRecognizer.ERROR_CLIENT,
                    SpeechRecognizer.ERROR_RECOGNIZER_BUSY,
                    // API 31+: service binder dropped mid-utterance (common on OEM restarts)
                    ERROR_SERVER_DISCONNECTED,
                    ERROR_TOO_MANY_REQUESTS,
                    -> {
                        consecutiveHardErrors = 0
                        val delay =
                            when (error) {
                                SpeechRecognizer.ERROR_RECOGNIZER_BUSY,
                                ERROR_TOO_MANY_REQUESTS,
                                -> 700L
                                ERROR_SERVER_DISCONNECTED -> 500L
                                else -> 350L
                            }
                        scheduleRestart(delayMs = delay)
                        return
                    }
                }

                // Transient hard-ish errors — retry a few times silently
                when (error) {
                    SpeechRecognizer.ERROR_NETWORK,
                    SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
                    SpeechRecognizer.ERROR_SERVER,
                    SpeechRecognizer.ERROR_AUDIO,
                    -> {
                        consecutiveHardErrors++
                        if (consecutiveHardErrors < MAX_HARD_RETRIES) {
                            Log.w(TAG, "transient error $error — retry $consecutiveHardErrors/$MAX_HARD_RETRIES")
                            scheduleRestart(delayMs = 700L)
                            return
                        }
                    }
                }

                // Give up only after repeated hard failures
                val msg =
                    when (error) {
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Mic permission needed"
                        SpeechRecognizer.ERROR_NETWORK,
                        SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
                        -> "Network needed for voice"
                        SpeechRecognizer.ERROR_AUDIO -> "Mic error"
                        SpeechRecognizer.ERROR_SERVER,
                        ERROR_SERVER_DISCONNECTED,
                        -> "Voice service error"
                        ERROR_TOO_MANY_REQUESTS -> "Voice busy — try again"
                        else -> errorLabel(error)
                    }
                failOut(msg)
            }

            override fun onEvent(
                eventType: Int,
                params: Bundle?,
            ) {}
        }

    private fun merge(
        base: String,
        spoken: String,
    ): String =
        when {
            spoken.isBlank() -> base
            base.isBlank() -> spoken
            else -> "$base $spoken"
        }

    private fun errorLabel(code: Int): String =
        when (code) {
            SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "Language pack missing"
            SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED -> "Language not supported"
            ERROR_SERVER_DISCONNECTED -> "Voice service disconnected"
            ERROR_TOO_MANY_REQUESTS -> "Voice busy"
            else -> "Voice failed ($code)"
        }

    companion object {
        private const val TAG = "AtomsSpeech"
        private const val MAX_HARD_RETRIES = 4

        // Not on older compile stubs as constants in all AGP versions — numeric from API 31.
        private const val ERROR_TOO_MANY_REQUESTS = 10
        private const val ERROR_SERVER_DISCONNECTED = 11
    }
}
