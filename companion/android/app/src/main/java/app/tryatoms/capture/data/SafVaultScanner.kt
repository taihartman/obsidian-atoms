package app.tryatoms.capture.data

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import app.tryatoms.capture.domain.CaptureLine
import app.tryatoms.capture.domain.VaultPathJoin
import app.tryatoms.capture.domain.VaultRef

/**
 * Walk a user-granted SAF tree and list every Obsidian vault (folder with `.obsidian`).
 */
class SafVaultScanner(
    private val context: Context,
) {
    fun listVaults(rootTreeUri: Uri): List<VaultRef> {
        val root =
            DocumentFile.fromTreeUri(context, rootTreeUri)
                ?: return emptyList()
        val found = ArrayList<VaultRef>()
        walk(root, relativePath = "", depth = 0, into = found)
        return found.sortedWith(
            compareByDescending<VaultRef> { it.score }.thenBy { it.name.lowercase() },
        )
    }

    private fun walk(
        dir: DocumentFile,
        relativePath: String,
        depth: Int,
        into: MutableList<VaultRef>,
    ) {
        if (depth > 5) return

        val children =
            try {
                dir.listFiles()
            } catch (_: Exception) {
                return
            }

        val hasObsidian =
            children.any { child ->
                child.isDirectory && child.name == ".obsidian"
            }

        if (hasObsidian) {
            val name = dir.name?.ifBlank { null } ?: relativePath.substringAfterLast('/').ifBlank { "Vault" }
            into.add(
                VaultRef(
                    name = name,
                    relativePath = relativePath,
                    score = score(children),
                ),
            )
            return // do not descend into vault internals
        }

        for (child in children) {
            if (!child.isDirectory) continue
            val name = child.name ?: continue
            if (name.startsWith(".")) continue
            if (name.equals("Android", ignoreCase = true)) continue
            walk(
                child,
                relativePath = VaultPathJoin.join(relativePath, name),
                depth = depth + 1,
                into = into,
            )
        }
    }

    private fun score(children: Array<DocumentFile>): Int {
        var s = 1
        if (children.any { it.isDirectory && it.name == CaptureLine.SYSTEM_FOLDER }) s += 10
        if (children.any { it.isDirectory && it.name == "Atoms" }) s += 3
        val obsidian = children.firstOrNull { it.isDirectory && it.name == ".obsidian" }
        val plugins = obsidian?.listFiles()?.firstOrNull { it.isDirectory && it.name == "plugins" }
        if (plugins?.listFiles()?.any { it.isDirectory && it.name == "atoms" } == true) s += 10
        return s
    }
}
