package app.tryatoms.capture

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color as AndroidColor
import android.graphics.PixelFormat
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.lifecycle.setViewTreeViewModelStoreOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import app.tryatoms.capture.data.CaptureRepository
import app.tryatoms.capture.data.InboxWriter
import app.tryatoms.capture.speech.InAppSpeech
import app.tryatoms.capture.ui.QuickCaptureScreen
import app.tryatoms.capture.ui.theme.AtomsTheme
import app.tryatoms.capture.widget.CaptureHomeWidget
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * System overlay capture strip when “Display over other apps” is allowed —
 * Android’s practical stand-in for a floating capture UI (no Live Activities).
 *
 * Overlay: full-width top bar, FLAG_NOT_TOUCH_MODAL → phone usable underneath.
 * Host activity: 1×1 not-touchable (doesn’t cover the screen).
 */
class QuickCaptureActivity : ComponentActivity() {
    private val repo by lazy { CaptureRepository(this) }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private var fieldValue by mutableStateOf(TextFieldValue(""))
    private var busy by mutableStateOf(false)
    private var listening by mutableStateOf(false)
    private var error by mutableStateOf<String?>(null)

    private var speech: InAppSpeech? = null
    private var overlayView: ComposeView? = null

    private val micPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) {
                error = null
                speech?.start(fieldValue.text)
            } else {
                error = "Mic permission needed for voice"
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

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

        if (canDrawOverlays()) {
            shrinkHostActivity()
            if (!attachOverlay()) {
                showAsTopActivityFallback()
            }
        } else {
            promptOverlayPermission()
            showAsTopActivityFallback()
        }
    }

    override fun onDestroy() {
        speech?.stop()
        speech = null
        detachOverlay()
        super.onDestroy()
    }

    private fun canDrawOverlays(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(this)
        } else {
            true
        }

    private fun promptOverlayPermission() {
        Toast
            .makeText(
                this,
                "Allow Display over other apps to use your phone while capturing",
                Toast.LENGTH_LONG,
            ).show()
        try {
            startActivity(
                Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    android.net.Uri.parse("package:$packageName"),
                ),
            )
        } catch (_: Exception) {
        }
    }

    private fun shrinkHostActivity() {
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

    private fun attachOverlay(): Boolean {
        if (overlayView != null) return true

        val type =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            } else {
                @Suppress("DEPRECATION")
                WindowManager.LayoutParams.TYPE_PHONE
            }

        val params =
            WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                type,
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT,
            ).apply {
                gravity = Gravity.TOP
                x = 0
                y = 0
                softInputMode =
                    WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE or
                    WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
            }

        val compose =
            ComposeView(this).apply {
                // Activity lifecycle — not a fake owner on a parent FrameLayout
                setViewTreeLifecycleOwner(this@QuickCaptureActivity)
                setViewTreeSavedStateRegistryOwner(this@QuickCaptureActivity)
                setViewTreeViewModelStoreOwner(this@QuickCaptureActivity)
                setContent {
                    AtomsTheme(darkTheme = isSystemInDarkTheme()) {
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
                            onCapture = { submit() },
                            onToggleVoice = { toggleVoice() },
                            onOpenHub = {
                                speech?.stop()
                                startActivity(
                                    Intent(this@QuickCaptureActivity, MainActivity::class.java)
                                        .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP),
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

        return try {
            (getSystemService(WINDOW_SERVICE) as WindowManager).addView(compose, params)
            overlayView = compose
            true
        } catch (e: Exception) {
            Toast.makeText(this, "Overlay failed: ${e.message}", Toast.LENGTH_SHORT).show()
            false
        }
    }

    private fun detachOverlay() {
        val view = overlayView ?: return
        try {
            (getSystemService(WINDOW_SERVICE) as WindowManager).removeView(view)
        } catch (_: Exception) {
        }
        overlayView = null
    }

    private fun showAsTopActivityFallback() {
        val w = window
        w.setFormat(PixelFormat.TRANSLUCENT)
        w.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
        w.clearFlags(
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
        )
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

        setContent {
            AtomsTheme(darkTheme = isSystemInDarkTheme()) {
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
                    onCapture = { submit() },
                    onToggleVoice = { toggleVoice() },
                    onOpenHub = {
                        speech?.stop()
                        startActivity(
                            Intent(this, MainActivity::class.java)
                                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP),
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

    private fun toggleVoice() {
        if (listening) {
            speech?.stop()
            return
        }
        val ok =
            ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED
        if (!ok) {
            micPermission.launch(Manifest.permission.RECORD_AUDIO)
        } else {
            error = null
            speech?.start(fieldValue.text)
        }
    }

    private fun submit() {
        speech?.stop()
        val text = fieldValue.text
        if (busy || text.isBlank()) return
        busy = true
        error = null
        scope.launch {
            val result = withContext(Dispatchers.IO) { repo.append(text) }
            when (result) {
                is InboxWriter.WriteResult.Ok -> {
                    repo.markCaptureDone("Saved · ${result.stamp} · ${result.preview}")
                    withContext(Dispatchers.IO) {
                        CaptureHomeWidget.updateAll(this@QuickCaptureActivity)
                    }
                    Toast.makeText(this@QuickCaptureActivity, "Saved", Toast.LENGTH_SHORT).show()
                    finish()
                }
                is InboxWriter.WriteResult.Err -> {
                    repo.setLastStatus("Failed · ${result.message}")
                    error = result.message
                    busy = false
                }
            }
        }
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
