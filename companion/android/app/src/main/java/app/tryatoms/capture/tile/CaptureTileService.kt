package app.tryatoms.capture.tile

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import app.tryatoms.capture.QuickCaptureActivity

/**
 * Quick Settings tile — appears in the pull-down shade after the user adds it
 * (edit tiles → Atoms Capture). Tap collapses the shade and opens the capture strip.
 */
class CaptureTileService : TileService() {
    override fun onStartListening() {
        qsTile?.apply {
            state = Tile.STATE_INACTIVE
            label = getString(app.tryatoms.capture.R.string.tile_capture)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                subtitle = getString(app.tryatoms.capture.R.string.tile_capture_sub)
            }
            updateTile()
        }
    }

    override fun onClick() {
        val launch = QuickCaptureActivity.launchIntent(this)
        val pi =
            PendingIntent.getActivity(
                this,
                0,
                launch,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(pi)
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(launch)
        }
    }

    companion object {
        fun component(context: Context): ComponentName =
            ComponentName(context, CaptureTileService::class.java)

        /**
         * Android 13+ system prompt to pin the tile. Returns false if unavailable
         * (older OS or no StatusBarManager).
         */
        fun requestAdd(context: Context): Boolean {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false
            return try {
                val sb = context.getSystemService(android.app.StatusBarManager::class.java)
                val icon =
                    android.graphics.drawable.Icon.createWithResource(
                        context,
                        app.tryatoms.capture.R.drawable.ic_atoms_mark,
                    )
                sb.requestAddTileService(
                    component(context),
                    context.getString(app.tryatoms.capture.R.string.tile_capture),
                    icon,
                    context.mainExecutor,
                ) { /* result code ignored — user may dismiss */ }
                true
            } catch (_: Exception) {
                false
            }
        }
    }
}
