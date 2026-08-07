package app.tryatoms.capture.data

import android.content.Context
import android.os.Environment
import app.tryatoms.capture.domain.DiscoveredVault
import app.tryatoms.capture.domain.VaultScanner
import java.io.File

class VaultLocator(
    private val context: Context,
) {
    fun discover(): List<DiscoveredVault> {
        val roots = linkedSetOf<File>()

        // Public shared storage (works when the OS still allows list access)
        Environment.getExternalStorageDirectory()?.let { roots.add(it) }
        roots.add(File("/storage/emulated/0"))
        roots.add(File("/sdcard"))

        listOf(
            Environment.DIRECTORY_DOCUMENTS,
            Environment.DIRECTORY_DOWNLOADS,
        ).forEach { type ->
            Environment.getExternalStoragePublicDirectory(type)?.let { roots.add(it) }
        }

        // Common Obsidian placements
        roots.add(File("/storage/emulated/0/Documents"))
        roots.add(File("/storage/emulated/0/Download"))
        roots.add(File("/storage/emulated/0/Downloads"))
        roots.add(File("/sdcard/Documents"))
        roots.add(File("/sdcard/Download"))

        // App-visible external dirs (rarely hold vaults, cheap to include)
        context.getExternalFilesDir(null)?.parentFile?.parentFile?.let { roots.add(it) }

        return VaultScanner.scan(roots.toList())
    }
}
