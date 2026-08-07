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
 * Partials stream while the mic is on. Segments auto-restart until stop.
 * Transient engine errors restart silently. A [session] generation token
 * ignores stale callbacks from cancelled recognizers (ERROR_CLIENT after cancel).
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
    private var session = 0
    private var restartRunnable: Runnable? = null
    private var consecutiveHardErrors = 0
    private var softRestarts = 0

    val isAvailable: Boolean
        get() = SpeechRecognizer.isRecognitionAvailable(host)

    fun start(existingText: String) {
        main.post {
            if (!isAvailable) {
                onError("Voice not available on this device")
                return@post
            }
            clearRestart()
            destroyQuietly()
            session++
            committed = existingText.trimEnd()
            partial = ""
            dictating = true
            consecutiveHardErrors = 0
            softRestarts = 0
            onListening(true)
            beginSegment()
        }
    }

    fun stop() {
        main.post {
            if (!dictating) {
                clearRestart()
                destroyQuietly()
                onListening(false)
                return@post
            }
            dictating = false
            session++
            clearRestart()
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
        session++
        clearRestart()
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
        val gen = session

        val r =
            try {
                SpeechRecognizer.createSpeechRecognizer(host)
            } catch (e: Exception) {
                Log.e(TAG, "create failed", e)
                failOut("Could not start mic: ${e.message}")
                return
            }

        recognizer = r
        r.setRecognitionListener(listener(gen))

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
            Log.i(TAG, "segment start gen=$gen")
        } catch (e: Exception) {
            Log.e(TAG, "startListening failed", e)
            scheduleRestart(delayMs = 500L)
        }
    }

    private fun scheduleRestart(delayMs: Long = 350L) {
        if (!dictating) return
        clearRestart()
        val task =
            Runnable {
                restartRunnable = null
                if (dictating) beginSegment()
            }
        restartRunnable = task
        main.postDelayed(task, delayMs)
    }

    private fun clearRestart() {
        restartRunnable?.let { main.removeCallbacks(it) }
        restartRunnable = null
    }

    private fun commitOpenPartial() {
        if (partial.isNotEmpty()) {
            committed = merge(committed, partial)
            partial = ""
            pushLive()
        }
    }

    private fun pushLive() {
        try {
            onLiveText(if (partial.isBlank()) committed else merge(committed, partial))
        } catch (_: Exception) {
        }
    }

    private fun failOut(message: String) {
        dictating = false
        session++
        clearRestart()
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

    private fun softRestart(error: Int) {
        softRestarts++
        if (softRestarts > MAX_SOFT_RESTARTS) {
            failOut("Voice kept dropping — try again")
            return
        }
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
    }

    private fun listener(gen: Int): RecognitionListener =
        object : RecognitionListener {
            private fun alive(): Boolean = dictating && gen == session

            override fun onReadyForSpeech(params: Bundle?) {
                if (!alive()) return
                Log.i(TAG, "onReadyForSpeech gen=$gen")
                consecutiveHardErrors = 0
            }

            override fun onBeginningOfSpeech() {
                if (alive()) Log.i(TAG, "onBeginningOfSpeech")
            }

            override fun onRmsChanged(rmsdB: Float) {}

            override fun onBufferReceived(buffer: ByteArray?) {}

            override fun onEndOfSpeech() {
                if (alive()) Log.i(TAG, "onEndOfSpeech")
            }

            override fun onPartialResults(partialResults: Bundle?) {
                if (!alive()) return
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
                if (!alive()) {
                    return
                }
                consecutiveHardErrors = 0
                softRestarts = 0
                val text =
                    results
                        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()
                        ?.trim()
                        .orEmpty()
                Log.i(TAG, "onResults gen=$gen len=${text.length}")
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
                if (!alive()) {
                    Log.d(TAG, "stale onError code=$error gen=$gen session=$session")
                    return
                }
                Log.w(TAG, "onError code=$error gen=$gen soft=$softRestarts")
                commitOpenPartial()

                when (error) {
                    SpeechRecognizer.ERROR_NO_MATCH,
                    SpeechRecognizer.ERROR_SPEECH_TIMEOUT,
                    SpeechRecognizer.ERROR_CLIENT,
                    SpeechRecognizer.ERROR_RECOGNIZER_BUSY,
                    ERROR_SERVER_DISCONNECTED,
                    ERROR_TOO_MANY_REQUESTS,
                    -> {
                        softRestart(error)
                        return
                    }
                }

                when (error) {
                    SpeechRecognizer.ERROR_NETWORK,
                    SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
                    SpeechRecognizer.ERROR_SERVER,
                    SpeechRecognizer.ERROR_AUDIO,
                    -> {
                        consecutiveHardErrors++
                        if (consecutiveHardErrors < MAX_HARD_RETRIES) {
                            scheduleRestart(delayMs = 700L)
                            return
                        }
                    }
                }

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
        private const val MAX_SOFT_RESTARTS = 24
        private const val ERROR_TOO_MANY_REQUESTS = 10
        private const val ERROR_SERVER_DISCONNECTED = 11
    }
}
