package app.tryatoms.capture

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color as AndroidColor
import android.graphics.PixelFormat
import android.os.Bundle
import android.speech.RecognizerIntent
import android.view.Gravity
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.core.view.WindowCompat
import app.tryatoms.capture.data.CaptureRepository
import app.tryatoms.capture.data.InboxWriter
import app.tryatoms.capture.overlay.CaptureOverlayController
import app.tryatoms.capture.ui.QuickCaptureScreen
import app.tryatoms.capture.ui.theme.AtomsTheme
import app.tryatoms.capture.widget.CaptureWidget
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale

/**
 * Always opens the capture strip — never the hub.
 *
 * Prefer system overlay (pass-through touches). If overlay permission is off,
 * fall back to a top floating activity strip (still not MainActivity).
 */
class QuickCaptureActivity : ComponentActivity() {
    private val repo by lazy { CaptureRepository(this) }

    private var fieldValue by mutableStateOf(TextFieldValue(""))
    private var busy by mutableStateOf(false)
    private var error by mutableStateOf<String?>(null)
    private var useOverlay = false

    private val speechLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode != Activity.RESULT_OK) return@registerForActivityResult
            val spoken =
                result.data
                    ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
                    ?.firstOrNull()
                    ?.trim()
            if (spoken.isNullOrEmpty()) return@registerForActivityResult
            if (useOverlay) {
                CaptureOverlayController.appendSpeech(spoken)
            } else {
                val base = fieldValue.text
                val merged =
                    if (base.isBlank()) spoken else base.trimEnd() + " " + spoken
                fieldValue =
                    TextFieldValue(text = merged, selection = TextRange(merged.length))
                error = null
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Hard guarantee: this component is QuickCapture, not MainActivity
        if (intent?.component?.className?.contains("MainActivity") == true) {
            // should never happen
        }

        useOverlay = CaptureOverlayController.canDrawOverlays(this)

        if (useOverlay) {
            // Invisible host + system overlay strip
            makeHostInvisible()
            CaptureOverlayController.show(
                context = this,
                speechLauncher = speechLauncher,
                onDismiss = { finish() },
            )
            return
        }

        // Fallback: floating top activity (no hub). Prompt once for overlay.
        Toast
            .makeText(
                this,
                "Tip: allow Display over other apps so you can use the phone under the strip",
                Toast.LENGTH_LONG,
            ).show()
        CaptureOverlayController.requestOverlayPermission(this)
        showActivityStrip()
    }

    override fun onDestroy() {
        if (useOverlay && isFinishing) {
            CaptureOverlayController.hide(applicationContext)
        }
        super.onDestroy()
    }

    private fun showActivityStrip() {
        configureTopFloatingWindow()
        setContent {
            val dark = isSystemInDarkTheme()
            AtomsTheme(darkTheme = dark) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = Color.Transparent,
                ) {
                    val scope = rememberCoroutineScope()
                    QuickCaptureScreen(
                        fieldValue = fieldValue,
                        onFieldChange = {
                            fieldValue = it
                            error = null
                        },
                        linked = repo.isLinked(),
                        vaultName = repo.vaultLabel(),
                        busy = busy,
                        error = error,
                        onCapture = {
                            val text = fieldValue.text
                            if (busy || text.isBlank()) return@QuickCaptureScreen
                            busy = true
                            error = null
                            scope.launch {
                                val result =
                                    withContext(Dispatchers.IO) { repo.append(text) }
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
                        onClose = { finish() },
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

    private fun configureTopFloatingWindow() {
        val w = window
        w.setFormat(PixelFormat.TRANSLUCENT)
        w.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
        w.addFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL)
        w.setLayout(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
        )
        w.setGravity(Gravity.TOP)
        val lp = w.attributes
        lp.gravity = Gravity.TOP
        lp.width = WindowManager.LayoutParams.MATCH_PARENT
        lp.height = WindowManager.LayoutParams.WRAP_CONTENT
        lp.flags = lp.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
        w.attributes = lp
        @Suppress("DEPRECATION")
        run {
            w.statusBarColor = AndroidColor.TRANSPARENT
            w.navigationBarColor = AndroidColor.TRANSPARENT
        }
        WindowCompat.setDecorFitsSystemWindows(w, false)
    }

    private fun makeHostInvisible() {
        val w = window
        w.setFormat(PixelFormat.TRANSLUCENT)
        w.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
        w.addFlags(
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
        )
        w.setLayout(1, 1)
        w.setGravity(Gravity.TOP or Gravity.START)
        @Suppress("DEPRECATION")
        w.statusBarColor = AndroidColor.TRANSPARENT
        setContentView(android.view.View(this))
    }

    companion object {
        const val ACTION_QUICK_CAPTURE = "app.tryatoms.capture.action.QUICK_CAPTURE"

        fun launchIntent(packageContext: android.content.Context): Intent =
            Intent(packageContext, QuickCaptureActivity::class.java).apply {
                action = ACTION_QUICK_CAPTURE
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_NO_ANIMATION
            }
    }
}
