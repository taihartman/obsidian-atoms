package app.tryatoms.capture

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity

/**
 * Instant trampoline: start overlay service → finish.
 * No full-screen UI. No waiting on permissions here (mic is asked inside strip).
 */
class QuickCaptureActivity : ComponentActivity() {
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
