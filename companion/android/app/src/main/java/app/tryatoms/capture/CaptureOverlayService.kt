package app.tryatoms.capture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.os.Build
import android.util.Log
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
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.lifecycle.setViewTreeViewModelStoreOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import app.tryatoms.capture.data.CaptureRepository
import app.tryatoms.capture.data.InboxWriter
import app.tryatoms.capture.overlay.ComposeTreeOwner
import app.tryatoms.capture.speech.InAppSpeech
import app.tryatoms.capture.ui.QuickCaptureScreen
import app.tryatoms.capture.ui.theme.AtomsTheme
import app.tryatoms.capture.widget.CaptureHomeWidget
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Foreground service hosting the capture strip as TYPE_APPLICATION_OVERLAY.
 * No Activity window → home/apps stay interactive underneath.
 */
class CaptureOverlayService : LifecycleService() {
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
                onLiveText = { text ->
                    if (isAlive()) {
                        Log.i(TAG, "live text len=${text.length}")
                        fieldValue = TextFieldValue(text = text, selection = TextRange(text.length))
                    }
                },
                onListening = { on ->
                    if (isAlive()) {
                        listening = on
                        // Mic FGS type only while actually dictating (API 34+ requirement).
                        promoteForeground(mic = on)
                    }
                },
                onError = { msg ->
                    if (isAlive()) {
                        Log.w(TAG, "speech error: $msg")
                        listening = false
                        error = msg
                        promoteForeground(mic = false)
                    }
                },
            )
    }

    override fun onStartCommand(
        intent: Intent?,
        flags: Int,
        startId: Int,
    ): Int {
        super.onStartCommand(intent, flags, startId)
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        promoteForeground(mic = listening)
        if (overlayView == null) {
            showOverlay()
        }
        return START_NOT_STICKY
    }

    /**
     * Overlay always needs specialUse. While the mic is open we must also declare
     * the microphone FGS type or Android 14+ blocks audio to SpeechRecognizer.
     */
    private fun promoteForeground(mic: Boolean) {
        val notif = buildNotification(if (mic) "Listening…" else "Capturing…")
        val type =
            if (Build.VERSION.SDK_INT >= 34) {
                var t = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                if (mic) t = t or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                t
            } else {
                0
            }
        try {
            ServiceCompat.startForeground(this, NOTIF_ID, notif, type)
            Log.i(TAG, "startForeground mic=$mic type=$type")
        } catch (e: Exception) {
            Log.e(TAG, "startForeground failed", e)
            // Last resort so we don't crash the strip
            try {
                startForeground(NOTIF_ID, notif)
            } catch (_: Exception) {
            }
        }
    }

    override fun onDestroy() {
        speech?.stopNow()
        speech = null
        removeOverlay()
        treeOwner.onDestroy()
        super.onDestroy()
    }

    private fun isAlive(): Boolean =
        lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)

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
                                    // End live feed — text already in the box stays
                                    speech?.stop()
                                } else {
                                    val ok =
                                        ContextCompat.checkSelfPermission(
                                            this@CaptureOverlayService,
                                            android.Manifest.permission.RECORD_AUDIO,
                                        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                                    if (!ok) {
                                        error =
                                            "Allow microphone — open hub once to grant mic"
                                        return@QuickCaptureScreen
                                    }
                                    error = null
                                    speech?.start(fieldValue.text)
                                }
                            },
                            onOpenHub = {
                                speech?.stopNow()
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
                                speech?.stopNow()
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
            view.disposeComposition()
        } catch (_: Exception) {
        }
        try {
            (getSystemService(WINDOW_SERVICE) as WindowManager).removeView(view)
        } catch (_: Exception) {
        }
        overlayView = null
    }

    private fun submit(repo: CaptureRepository) {
        speech?.stopNow()
        val text = fieldValue.text
        if (busy || text.isBlank()) return
        busy = true
        error = null
        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) { repo.append(text) }
            if (!isActive || !isAlive()) return@launch
            when (result) {
                is InboxWriter.WriteResult.Ok -> {
                    repo.markCaptureDone("Saved · ${result.stamp} · ${result.preview}")
                    withContext(Dispatchers.IO) {
                        CaptureHomeWidget.updateAll(this@CaptureOverlayService)
                    }
                    if (isAlive()) {
                        Toast.makeText(this@CaptureOverlayService, "Saved", Toast.LENGTH_SHORT).show()
                        stopSelf()
                    }
                }
                is InboxWriter.WriteResult.Err -> {
                    repo.setLastStatus("Failed · ${result.message}")
                    if (isAlive()) {
                        error = result.message
                        busy = false
                    }
                }
            }
        }
    }

    private fun buildNotification(status: String): Notification {
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
        val stopIntent =
            Intent(this, CaptureOverlayService::class.java).setAction(ACTION_STOP)
        val stopPi =
            PendingIntent.getService(
                this,
                1,
                stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Atoms Capture")
            .setContentText(status)
            .setSmallIcon(R.drawable.ic_atoms_mark)
            .setOngoing(true)
            .addAction(0, "Stop", stopPi)
            .build()
    }

    companion object {
        private const val TAG = "AtomsOverlay"
        private const val CHANNEL_ID = "atoms_capture_overlay"
        private const val NOTIF_ID = 42
        const val ACTION_STOP = "app.tryatoms.capture.STOP_OVERLAY"

        fun start(context: Context) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, CaptureOverlayService::class.java),
            )
        }
    }
}
