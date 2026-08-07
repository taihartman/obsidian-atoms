package app.tryatoms.capture.data

import android.os.Environment
import android.util.Log
import app.tryatoms.capture.domain.DiscoveredVault
import app.tryatoms.capture.domain.VaultScanner
import java.io.File

/** File-tree scan for Obsidian vaults (needs all-files access on modern Android). */
object VaultLocator {
    private const val TAG = "AtomsCaptureScan"

    fun discover(): List<DiscoveredVault> {
        val roots = linkedSetOf<File>()
        Environment.getExternalStorageDirectory()?.let { roots.add(it) }
        roots.add(File("/storage/emulated/0"))
        roots.add(File("/sdcard"))
        listOf(
            Environment.DIRECTORY_DOCUMENTS,
            Environment.DIRECTORY_DOWNLOADS,
        ).forEach { type ->
            Environment.getExternalStoragePublicDirectory(type)?.let { roots.add(it) }
        }
        roots.add(File("/storage/emulated/0/Documents"))
        roots.add(File("/sdcard/Documents"))
        roots.add(File("/storage/emulated/0/Download"))
        roots.add(File("/sdcard/Download"))
        roots.add(File("/storage/emulated/0/Obsidian"))
        roots.add(File("/sdcard/Obsidian"))

        val found = VaultScanner.scan(roots.toList())
        Log.i(TAG, "file discover count=${found.size} ${found.map { it.name }}")
        return found
    }
}
