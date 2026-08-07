package app.tryatoms.capture

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color as AndroidColor
import android.graphics.PixelFormat
import android.os.Bundle
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
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import app.tryatoms.capture.data.CaptureRepository
import app.tryatoms.capture.data.InboxWriter
import app.tryatoms.capture.speech.InAppSpeech
import app.tryatoms.capture.ui.QuickCaptureScreen
import app.tryatoms.capture.ui.theme.AtomsTheme
import app.tryatoms.capture.widget.CaptureHomeWidget
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
// Toast is android.widget.Toast

/**
 * Full-width top capture bar. In-app mic (no system voice sheet).
 */
class QuickCaptureActivity : ComponentActivity() {
    private val repo by lazy { CaptureRepository(this) }

    private var fieldValue by mutableStateOf(TextFieldValue(""))
    private var busy by mutableStateOf(false)
    private var listening by mutableStateOf(false)
    private var error by mutableStateOf<String?>(null)

    private var speech: InAppSpeech? = null

    private val micPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) {
                beginListen()
            } else {
                error = "Mic permission needed for voice"
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        configureTopFloatingWindow()

        speech =
            InAppSpeech(
                context = this,
                onPartial = { text ->
                    fieldValue = TextFieldValue(text = text, selection = TextRange(text.length))
                },
                onFinal = { text ->
                    fieldValue = TextFieldValue(text = text, selection = TextRange(text.length))
                    listening = false
                },
                onListening = { on -> listening = on },
                onError = { msg ->
                    listening = false
                    error = msg
                },
            )

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
                        listening = listening,
                        error = error,
                        onCapture = {
                            speech?.stop()
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
                                            CaptureHomeWidget.updateAll(this@QuickCaptureActivity)
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
                        onToggleVoice = { toggleVoice() },
                        onOpenHub = {
                            speech?.stop()
                            startActivity(
                                android.content.Intent(this, MainActivity::class.java).apply {
                                    addFlags(android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP)
                                },
                            )
                            finish()
                        },
                        onClose = {
                            speech?.stop()
                            finish()
                        },
                    )
                }
            }
        }
    }

    override fun onDestroy() {
        speech?.stop()
        speech = null
        super.onDestroy()
    }

    private fun toggleVoice() {
        if (listening) {
            speech?.stop()
            return
        }
        val granted =
            ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED
        if (!granted) {
            micPermission.launch(Manifest.permission.RECORD_AUDIO)
        } else {
            beginListen()
        }
    }

    private fun beginListen() {
        error = null
        speech?.start(fieldValue.text)
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
        lp.horizontalMargin = 0f
        lp.x = 0
        lp.flags = lp.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
        w.attributes = lp
        @Suppress("DEPRECATION")
        run {
            w.statusBarColor = AndroidColor.TRANSPARENT
            w.navigationBarColor = AndroidColor.TRANSPARENT
        }
        WindowCompat.setDecorFitsSystemWindows(w, false)
    }

    companion object {
        const val ACTION_QUICK_CAPTURE = "app.tryatoms.capture.action.QUICK_CAPTURE"

        fun launchIntent(packageContext: android.content.Context): android.content.Intent =
            android.content.Intent(packageContext, QuickCaptureActivity::class.java).apply {
                action = ACTION_QUICK_CAPTURE
                flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK or
                    android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    android.content.Intent.FLAG_ACTIVITY_NO_ANIMATION
            }
    }
}
