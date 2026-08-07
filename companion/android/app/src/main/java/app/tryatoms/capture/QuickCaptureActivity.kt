package app.tryatoms.capture

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.view.WindowCompat
import app.tryatoms.capture.data.CaptureRepository
import app.tryatoms.capture.data.InboxWriter
import app.tryatoms.capture.ui.QuickCaptureScreen
import app.tryatoms.capture.ui.theme.AtomsTheme
import app.tryatoms.capture.widget.CaptureWidget
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * One-second capture path — keyboard up, save, finish.
 * Entry: widget, launcher shortcut, or explicit intent.
 */
class QuickCaptureActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        WindowCompat.setDecorFitsSystemWindows(window, false)

        val repo = CaptureRepository(this)

        setContent {
            val dark = isSystemInDarkTheme()
            AtomsTheme(darkTheme = dark) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    var draft by remember { mutableStateOf("") }
                    var busy by remember { mutableStateOf(false) }
                    var error by remember { mutableStateOf<String?>(null) }
                    val scope = rememberCoroutineScope()
                    val linked = repo.isLinked()
                    val vaultName = repo.vaultLabel()

                    QuickCaptureScreen(
                        draft = draft,
                        onDraftChange = {
                            draft = it
                            error = null
                        },
                        linked = linked,
                        vaultName = vaultName,
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
                                        CaptureWidget.updateAll(this@QuickCaptureActivity)
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
                        onOpenHub = {
                            startActivity(
                                Intent(this, MainActivity::class.java).apply {
                                    addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
                                },
                            )
                            finish()
                        },
                        onCancel = { finish() },
                    )
                }
            }
        }
    }

    companion object {
        const val ACTION_QUICK_CAPTURE = "app.tryatoms.capture.action.QUICK_CAPTURE"
    }
}
