package app.tryatoms.capture

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Bundle
import android.speech.RecognizerIntent
import android.view.Gravity
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import app.tryatoms.capture.overlay.CaptureOverlayController

/**
 * Invisible host for the system overlay + speech launcher.
 * Overlay draws the UI; this activity is 1×1 and not touchable so the phone
 * stays usable. Kept alive so voice [ActivityResult] works.
 */
class QuickCaptureActivity : ComponentActivity() {
    private val speechLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode != Activity.RESULT_OK) return@registerForActivityResult
            val spoken =
                result.data
                    ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
                    ?.firstOrNull()
                    ?.trim()
            if (!spoken.isNullOrEmpty()) {
                CaptureOverlayController.appendSpeech(spoken)
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        makeHostInvisible()

        if (!CaptureOverlayController.canDrawOverlays(this)) {
            CaptureOverlayController.requestOverlayPermission(this)
            Toast
                .makeText(
                    this,
                    "Turn on Display over other apps, then tap Capture again",
                    Toast.LENGTH_LONG,
                ).show()
            finish()
            return
        }

        CaptureOverlayController.show(
            context = this,
            speechLauncher = speechLauncher,
            onDismiss = { finish() },
        )
    }

    override fun onDestroy() {
        // If system kills us, tear down overlay
        if (isFinishing) {
            CaptureOverlayController.hide(applicationContext)
        }
        super.onDestroy()
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
        w.statusBarColor = Color.TRANSPARENT
        setContentView(android.view.View(this))
    }

    companion object {
        const val ACTION_QUICK_CAPTURE = "app.tryatoms.capture.action.QUICK_CAPTURE"
    }
}
