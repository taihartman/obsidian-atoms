package app.tryatoms.capture.data

import android.os.Build
import android.os.Environment
import app.tryatoms.capture.domain.DiscoveredVault

/**
 * Sideload build: all-files access is available, so vaults can be found without
 * the user pointing at a folder.
 */
object FileTreeAccess {
    const val SUPPORTED: Boolean = true

    fun granted(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            true
        }

    fun discover(): List<DiscoveredVault> = VaultLocator.discover()
}
