package app.tryatoms.capture

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat

/**
 * Instant trampoline: ensure overlay + mic grants → start overlay service → finish.
 * No full-screen capture UI.
 */
class QuickCaptureActivity : ComponentActivity() {
    private val requestMic =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            // Start overlay regardless — voice can be granted later from hub if denied
            startOverlayAndFinish()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (!canDrawOverlays()) {
            Toast
                .makeText(
                    this,
                    "Allow Display over other apps for Atoms Capture",
                    Toast.LENGTH_LONG,
                ).show()
            try {
                startActivity(
                    Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        android.net.Uri.parse("package:$packageName"),
                    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            } catch (_: Exception) {
            }
            finish()
            return
        }

        val micOk =
            ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED
        if (!micOk) {
            requestMic.launch(Manifest.permission.RECORD_AUDIO)
        } else {
            startOverlayAndFinish()
        }
    }

    private fun startOverlayAndFinish() {
        try {
            CaptureOverlayService.start(this)
        } catch (e: Exception) {
            Toast.makeText(this, "Could not start capture: ${e.message}", Toast.LENGTH_LONG).show()
        }
        finish()
    }

    private fun canDrawOverlays(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(this)
        } else {
            true
        }

    companion object {
        const val ACTION_QUICK_CAPTURE = "app.tryatoms.capture.action.QUICK_CAPTURE"

        fun launchIntent(packageContext: android.content.Context): Intent =
            Intent(packageContext, QuickCaptureActivity::class.java).apply {
                action = ACTION_QUICK_CAPTURE
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_NO_ANIMATION or
                    Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS
            }
    }
}
