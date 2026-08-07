package app.tryatoms.capture.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.provider.Settings
import android.speech.RecognizerIntent
import android.view.Gravity
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.savedstate.SavedStateRegistry
import androidx.savedstate.SavedStateRegistryController
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import app.tryatoms.capture.MainActivity
import app.tryatoms.capture.data.CaptureRepository
import app.tryatoms.capture.data.InboxWriter
import app.tryatoms.capture.ui.QuickCaptureScreen
import app.tryatoms.capture.ui.theme.AtomsTheme
import app.tryatoms.capture.widget.CaptureWidget
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale

/**
 * System overlay bubble (TYPE_APPLICATION_OVERLAY).
 * Only the strip receives touches; everything below stays interactive.
 */
object CaptureOverlayController {
    private var rootView: FrameLayout? = null
    private var lifecycleOwner: OverlayLifecycleOwner? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private var fieldValue by mutableStateOf(TextFieldValue(""))
    private var busy by mutableStateOf(false)
    private var error by mutableStateOf<String?>(null)

    fun isShowing(): Boolean = rootView != null

    fun canDrawOverlays(context: Context): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(context)
        } else {
            true
        }

    fun requestOverlayPermission(activity: ComponentActivity) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val intent =
                Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    android.net.Uri.parse("package:${activity.packageName}"),
                )
            activity.startActivity(intent)
            Toast
                .makeText(
                    activity,
                    "Allow “Display over other apps” for Atoms Capture, then try again",
                    Toast.LENGTH_LONG,
                ).show()
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private var onDismissHost: (() -> Unit)? = null

    fun show(
        context: Context,
        speechLauncher: ActivityResultLauncher<Intent>?,
        onDismiss: (() -> Unit)? = null,
    ) {
        val app = context.applicationContext
        if (!canDrawOverlays(app)) {
            Toast
                .makeText(
                    app,
                    "Need display-over-apps permission once",
                    Toast.LENGTH_LONG,
                ).show()
            return
        }
        if (rootView != null) return

        onDismissHost = onDismiss
        fieldValue = TextFieldValue("")
        busy = false
        error = null

        val wm = app.getSystemService(Context.WINDOW_SERVICE) as WindowManager
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
                // NOT_TOUCH_MODAL: touches outside this window go to apps below
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT,
            ).apply {
                gravity = Gravity.TOP
                softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
            }

        val owner = OverlayLifecycleOwner().also { it.onCreate() }
        lifecycleOwner = owner

        val compose =
            ComposeView(app).apply {
                setViewTreeLifecycleOwner(owner)
                setViewTreeSavedStateRegistryOwner(owner)
                setContent {
                    val dark = isSystemInDarkTheme()
                    val repo = CaptureRepository(app)
                    AtomsTheme(darkTheme = dark) {
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
                            onCapture = { submit(app, repo) },
                            onVoice = {
                                if (speechLauncher != null) {
                                    launchSpeech(speechLauncher)
                                } else {
                                    Toast
                                        .makeText(app, "Voice unavailable", Toast.LENGTH_SHORT)
                                        .show()
                                }
                            },
                            onOpenHub = {
                                app.startActivity(
                                    Intent(app, MainActivity::class.java).apply {
                                        addFlags(
                                            Intent.FLAG_ACTIVITY_NEW_TASK or
                                                Intent.FLAG_ACTIVITY_CLEAR_TOP,
                                        )
                                    },
                                )
                                hide(app)
                            },
                            onClose = { hide(app) },
                        )
                    }
                }
            }

        val root =
            FrameLayout(app).apply {
                addView(
                    compose,
                    FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.WRAP_CONTENT,
                    ),
                )
            }

        try {
            wm.addView(root, params)
            rootView = root
            owner.onResume()
        } catch (e: Exception) {
            Toast.makeText(app, "Overlay failed: ${e.message}", Toast.LENGTH_LONG).show()
            rootView = null
            lifecycleOwner = null
        }
    }

    fun hide(context: Context) {
        val app = context.applicationContext
        val root = rootView ?: return
        val wm = app.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        try {
            wm.removeView(root)
        } catch (_: Exception) {
        }
        rootView = null
        lifecycleOwner?.onDestroy()
        lifecycleOwner = null
        fieldValue = TextFieldValue("")
        busy = false
        error = null
        val host = onDismissHost
        onDismissHost = null
        host?.invoke()
    }

    fun appendSpeech(spoken: String) {
        val base = fieldValue.text
        val merged =
            if (base.isBlank()) {
                spoken
            } else {
                base.trimEnd() + " " + spoken
            }
        fieldValue =
            TextFieldValue(
                text = merged,
                selection = TextRange(merged.length),
            )
        error = null
    }

    private fun launchSpeech(launcher: ActivityResultLauncher<Intent>) {
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
            launcher.launch(intent)
        } catch (_: Exception) {
            // caller may toast
        }
    }

    private fun submit(
        app: Context,
        repo: CaptureRepository,
    ) {
        val text = fieldValue.text
        if (busy || text.isBlank()) return
        busy = true
        error = null
        scope.launch {
            val result =
                withContext(Dispatchers.IO) {
                    repo.append(text)
                }
            when (result) {
                is InboxWriter.WriteResult.Ok -> {
                    repo.markCaptureDone("Saved · ${result.stamp} · ${result.preview}")
                    withContext(Dispatchers.IO) {
                        CaptureWidget.updateAll(app)
                    }
                    Toast.makeText(app, "Saved", Toast.LENGTH_SHORT).show()
                    hide(app)
                }
                is InboxWriter.WriteResult.Err -> {
                    repo.setLastStatus("Failed · ${result.message}")
                    error = result.message
                    busy = false
                }
            }
        }
    }
}

/** Minimal lifecycle for ComposeView hosted in WindowManager. */
private class OverlayLifecycleOwner : LifecycleOwner, SavedStateRegistryOwner {
    private val lifecycleRegistry = LifecycleRegistry(this)
    private val savedStateController = SavedStateRegistryController.create(this)

    init {
        savedStateController.performRestore(null)
    }

    override val lifecycle: Lifecycle get() = lifecycleRegistry
    override val savedStateRegistry: SavedStateRegistry
        get() = savedStateController.savedStateRegistry

    fun onCreate() {
        lifecycleRegistry.currentState = Lifecycle.State.CREATED
        lifecycleRegistry.currentState = Lifecycle.State.STARTED
    }

    fun onResume() {
        lifecycleRegistry.currentState = Lifecycle.State.RESUMED
    }

    fun onDestroy() {
        lifecycleRegistry.currentState = Lifecycle.State.DESTROYED
    }
}
