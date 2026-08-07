package app.tryatoms.capture.domain

import android.net.Uri
import java.io.File
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

/**
 * Find Obsidian vault folders and map them to SAF tree URIs for a one-tap grant.
 *
 * A vault is a directory that contains a `.obsidian` child. Prefer vaults that
 * already have Atoms (`Atoms System/` or the plugin under `.obsidian/plugins/atoms`).
 */
data class DiscoveredVault(
    val name: String,
    val absolutePath: String,
    /** Higher = better default (Atoms-ready vaults win). */
    val score: Int,
) {
    val treeUriString: String?
        get() = VaultPaths.filePathToTreeUriString(absolutePath)

    val treeUri: Uri?
        get() = treeUriString?.let { Uri.parse(it) }
}

object VaultPaths {
    private const val EXT_STORAGE_AUTHORITY = "com.android.externalstorage.documents"

    /**
     * `/storage/emulated/0/Documents/Remote Vault`
     * → `content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FRemote%20Vault`
     *
     * String form is pure JVM (unit-testable); [filePathToTreeUri] wraps [Uri.parse].
     */
    fun filePathToTreeUriString(absolutePath: String): String? {
        val relative = primaryRelativePath(absolutePath) ?: return null
        return treeUriStringForDocumentId("primary:$relative")
    }

    fun filePathToTreeUri(absolutePath: String): Uri? =
        filePathToTreeUriString(absolutePath)?.let { Uri.parse(it) }

    /** Documents root — good default start for the manual picker. */
    fun documentsTreeUriString(): String = treeUriStringForDocumentId("primary:Documents")

    fun documentsTreeUri(): Uri = Uri.parse(documentsTreeUriString())

    fun treeUriStringForDocumentId(documentId: String): String {
        val encoded =
            URLEncoder.encode(documentId, StandardCharsets.UTF_8.name()).replace("+", "%20")
        return "content://$EXT_STORAGE_AUTHORITY/tree/$encoded"
    }

    fun primaryRelativePath(absolutePath: String): String? {
        val normalized = absolutePath.replace('\\', '/').trimEnd('/')
        val prefixes =
            listOf(
                "/storage/emulated/0/",
                "/sdcard/",
                "/mnt/sdcard/",
            )
        for (prefix in prefixes) {
            if (normalized.startsWith(prefix)) {
                val rel = normalized.removePrefix(prefix)
                if (rel.isNotEmpty()) return rel
            }
        }
        return null
    }
}

object VaultScanner {
    private val SKIP_DIR_NAMES =
        setOf(
            "Android",
            "android",
            ".",
            "..",
            "DCIM",
            "Pictures",
            "Movies",
            "Music",
            "Podcasts",
            "Ringtones",
            "Alarms",
            "Notifications",
            "Audiobooks",
        )

    fun scan(roots: List<File>): List<DiscoveredVault> {
        val found = LinkedHashMap<String, DiscoveredVault>()
        for (root in roots) {
            if (!root.isDirectory) continue
            consider(root, found)
            val children =
                try {
                    root.listFiles() ?: emptyArray()
                } catch (_: SecurityException) {
                    emptyArray()
                }
            for (child in children) {
                if (!child.isDirectory) continue
                if (child.name in SKIP_DIR_NAMES) continue
                if (child.name.startsWith(".")) continue
                consider(child, found)
                // One more level under Documents-style roots only
                if (root.name.equals("Documents", ignoreCase = true) ||
                    root.name.equals("Download", ignoreCase = true) ||
                    root.name.equals("Downloads", ignoreCase = true)
                ) {
                    val grand =
                        try {
                            child.listFiles() ?: emptyArray()
                        } catch (_: SecurityException) {
                            emptyArray()
                        }
                    for (g in grand) {
                        if (!g.isDirectory) continue
                        if (g.name.startsWith(".")) continue
                        consider(g, found)
                    }
                }
            }
        }
        return found.values.sortedWith(
            compareByDescending<DiscoveredVault> { it.score }.thenBy { it.name.lowercase() },
        )
    }

    private fun consider(
        dir: File,
        into: MutableMap<String, DiscoveredVault>,
    ) {
        val obsidian = File(dir, ".obsidian")
        if (!obsidian.isDirectory) return
        val path =
            try {
                dir.canonicalPath
            } catch (_: Exception) {
                dir.absolutePath
            }
        if (into.containsKey(path)) return
        into[path] =
            DiscoveredVault(
                name = dir.name.ifBlank { path },
                absolutePath = path,
                score = score(dir),
            )
    }

    fun score(vaultDir: File): Int {
        var s = 1
        if (File(vaultDir, "Atoms System").isDirectory) s += 10
        if (File(vaultDir, "Atoms").isDirectory) s += 3
        if (File(vaultDir, ".obsidian/plugins/atoms").isDirectory) s += 10
        return s
    }
}
