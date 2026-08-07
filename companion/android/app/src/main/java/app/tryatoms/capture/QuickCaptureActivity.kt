package app.tryatoms.capture

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import android.speech.RecognizerIntent
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.core.view.WindowCompat
import app.tryatoms.capture.data.CaptureRepository
import app.tryatoms.capture.data.InboxWriter
import app.tryatoms.capture.ui.QuickCaptureScreen
import app.tryatoms.capture.ui.theme.AtomsTheme
import app.tryatoms.capture.widget.CaptureWidget
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale

/**
 * Floating top strip: type or native voice → check to send.
 * Not a full-screen hub page.
 */
class QuickCaptureActivity : ComponentActivity() {
    private val repo by lazy { CaptureRepository(this) }

    private var draft by mutableStateOf("")
    private var busy by mutableStateOf(false)
    private var error by mutableStateOf<String?>(null)

    private val speechLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode != Activity.RESULT_OK) return@registerForActivityResult
            val spoken =
                result.data
                    ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
                    ?.firstOrNull()
                    ?.trim()
            if (!spoken.isNullOrEmpty()) {
                draft =
                    if (draft.isBlank()) {
                        spoken
                    } else {
                        draft.trimEnd() + " " + spoken
                    }
                error = null
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        WindowCompat.setDecorFitsSystemWindows(window, false)

        setContent {
            val dark = isSystemInDarkTheme()
            AtomsTheme(darkTheme = dark) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = Color.Transparent,
                ) {
                    val scope = rememberCoroutineScope()
                    QuickCaptureScreen(
                        draft = draft,
                        onDraftChange = {
                            draft = it
                            error = null
                        },
                        linked = repo.isLinked(),
                        vaultName = repo.vaultLabel(),
                        busy = busy,
                        error = error,
                        onCapture = {
                            if (busy || draft.isBlank()) return@QuickCaptureScreen
                            busy = true
                            error = null
                            val text = draft
                            scope.launch {
                                val result =
                                    withContext(Dispatchers.IO) {
                                        repo.append(text)
                                    }
                                when (result) {
                                    is InboxWriter.WriteResult.Ok -> {
                                        repo.markCaptureDone(
                                            "Saved · ${result.stamp} · ${result.preview}",
                                        )
                                        withContext(Dispatchers.IO) {
                                            CaptureWidget.updateAll(this@QuickCaptureActivity)
                                        }
                                        Toast
                                            .makeText(
                                                this@QuickCaptureActivity,
                                                "Saved",
                                                Toast.LENGTH_SHORT,
                                            ).show()
                                        finish()
                                    }
                                    is InboxWriter.WriteResult.Err -> {
                                        repo.setLastStatus("Failed · ${result.message}")
                                        error = result.message
                                        busy = false
                                    }
                                }
                            }
                        },
                        onVoice = { startNativeVoice() },
                        onOpenHub = {
                            startActivity(
                                Intent(this, MainActivity::class.java).apply {
                                    addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
                                },
                            )
                            finish()
                        },
                        onDismiss = { finish() },
                    )
                }
            }
        }
    }

    private fun startNativeVoice() {
        val intent =
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
                )
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                putExtra(RecognizerIntent.EXTRA_PROMPT, "What’s on your mind?")
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            }
        try {
            speechLauncher.launch(intent)
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, "No voice input on this device", Toast.LENGTH_SHORT).show()
        }
    }

    companion object {
        const val ACTION_QUICK_CAPTURE = "app.tryatoms.capture.action.QUICK_CAPTURE"
    }
}
