package app.tryatoms.capture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.WindowManager
import android.widget.Toast
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.lifecycle.setViewTreeViewModelStoreOwner
import androidx.savedstate.SavedStateRegistry
import androidx.savedstate.SavedStateRegistryController
import androidx.savedstate.SavedStateRegistryOwner
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
 * Foreground service hosting the capture strip as TYPE_APPLICATION_OVERLAY.
 * No Activity window on screen → home/apps stay fully interactive underneath.
 */
class CaptureOverlayService : LifecycleService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var overlayView: ComposeView? = null
    private val treeOwner = ComposeTreeOwner()

    private var fieldValue by mutableStateOf(TextFieldValue(""))
    private var busy by mutableStateOf(false)
    private var listening by mutableStateOf(false)
    private var error by mutableStateOf<String?>(null)
    private var speech: InAppSpeech? = null

    override fun onCreate() {
        super.onCreate()
        treeOwner.onCreate()
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
    }

    override fun onStartCommand(
        intent: Intent?,
        flags: Int,
        startId: Int,
    ): Int {
        super.onStartCommand(intent, flags, startId)
        startForeground(NOTIF_ID, buildNotification())
        if (overlayView == null) {
            showOverlay()
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        speech?.stop()
        speech = null
        removeOverlay()
        super.onDestroy()
    }

    override fun onBind(intent: Intent): IBinder? {
        super.onBind(intent)
        return null
    }

    private fun showOverlay() {
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

        val repo = CaptureRepository(this)
        val compose =
            ComposeView(this).apply {
                setViewTreeLifecycleOwner(treeOwner)
                setViewTreeSavedStateRegistryOwner(treeOwner)
                setViewTreeViewModelStoreOwner(treeOwner)
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
                            onCapture = { submit(repo) },
                            onToggleVoice = {
                                if (listening) {
                                    speech?.stop()
                                } else {
                                    val ok =
                                        ContextCompat.checkSelfPermission(
                                            this@CaptureOverlayService,
                                            android.Manifest.permission.RECORD_AUDIO,
                                        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                                    if (!ok) {
                                        // Can't show runtime dialog from a Service — open hub settings path
                                        error = "Allow microphone in system settings for Atoms Capture"
                                        return@QuickCaptureScreen
                                    }
                                    if (speech?.isAvailable != true) {
                                        error = "Voice not available on this device"
                                        return@QuickCaptureScreen
                                    }
                                    error = null
                                    speech?.start(fieldValue.text)
                                }
                            },
                            onOpenHub = {
                                speech?.stop()
                                startActivity(
                                    Intent(this@CaptureOverlayService, MainActivity::class.java)
                                        .addFlags(
                                            Intent.FLAG_ACTIVITY_NEW_TASK or
                                                Intent.FLAG_ACTIVITY_CLEAR_TOP,
                                        ),
                                )
                                stopSelf()
                            },
                            onClose = {
                                speech?.stop()
                                stopSelf()
                            },
                        )
                    }
                }
            }

        try {
            (getSystemService(WINDOW_SERVICE) as WindowManager).addView(compose, params)
            overlayView = compose
            treeOwner.onResume()
        } catch (e: Exception) {
            Toast.makeText(this, "Could not show capture: ${e.message}", Toast.LENGTH_LONG).show()
            stopSelf()
        }
    }

    private fun removeOverlay() {
        val view = overlayView ?: return
        try {
            (getSystemService(WINDOW_SERVICE) as WindowManager).removeView(view)
        } catch (_: Exception) {
        }
        overlayView = null
        treeOwner.onDestroy()
    }

    private fun submit(repo: CaptureRepository) {
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
                        CaptureHomeWidget.updateAll(this@CaptureOverlayService)
                    }
                    Toast.makeText(this@CaptureOverlayService, "Saved", Toast.LENGTH_SHORT).show()
                    stopSelf()
                }
                is InboxWriter.WriteResult.Err -> {
                    repo.setLastStatus("Failed · ${result.message}")
                    error = result.message
                    busy = false
                }
            }
        }
    }

    private fun buildNotification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "Capture",
                    NotificationManager.IMPORTANCE_LOW,
                ),
            )
        }
        val pi =
            PendingIntent.getService(
                this,
                0,
                Intent(this, CaptureOverlayService::class.java).setAction(ACTION_STOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Atoms Capture")
            .setContentText("Capturing…")
            .setSmallIcon(android.R.drawable.ic_menu_edit)
            .setContentIntent(pi)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "atoms_capture_overlay"
        private const val NOTIF_ID = 42
        const val ACTION_STOP = "app.tryatoms.capture.STOP_OVERLAY"

        fun start(context: Context) {
            val i = Intent(context, CaptureOverlayService::class.java)
            ContextCompat.startForegroundService(context, i)
        }
    }
}

/** Lifecycle + SavedState + ViewModelStore for ComposeView outside an Activity. */
private class ComposeTreeOwner :
    LifecycleOwner,
    SavedStateRegistryOwner,
    ViewModelStoreOwner {
    private val lifecycleRegistry = LifecycleRegistry(this)
    private val savedStateController = SavedStateRegistryController.create(this)
    private val store = ViewModelStore()

    init {
        savedStateController.performRestore(null)
    }

    override val lifecycle: Lifecycle get() = lifecycleRegistry
    override val savedStateRegistry: SavedStateRegistry
        get() = savedStateController.savedStateRegistry
    override val viewModelStore: ViewModelStore get() = store

    fun onCreate() {
        lifecycleRegistry.currentState = Lifecycle.State.CREATED
        lifecycleRegistry.currentState = Lifecycle.State.STARTED
    }

    fun onResume() {
        lifecycleRegistry.currentState = Lifecycle.State.RESUMED
    }

    fun onDestroy() {
        store.clear()
        lifecycleRegistry.currentState = Lifecycle.State.DESTROYED
    }
}
