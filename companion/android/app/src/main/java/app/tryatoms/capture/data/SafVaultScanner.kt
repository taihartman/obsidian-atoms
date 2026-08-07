package app.tryatoms.capture.data

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Log
import androidx.documentfile.provider.DocumentFile
import app.tryatoms.capture.domain.CaptureLine
import app.tryatoms.capture.domain.VaultPathJoin
import app.tryatoms.capture.domain.VaultRef

/**
 * Walk a user-granted SAF tree and list every Obsidian vault.
 *
 * Important: ExternalStorageProvider on modern Android often **omits dot-directories**
 * from [DocumentFile.listFiles], so `.obsidian` never appears in the listing.
 * Detection must use [DocumentFile.findFile] (and DocumentsContract) by name,
 * plus non-hidden Atoms markers as fallbacks.
 */
class SafVaultScanner(
    private val context: Context,
) {
    fun listVaults(rootTreeUri: Uri): List<VaultRef> {
        val root =
            DocumentFile.fromTreeUri(context, rootTreeUri)
                ?: run {
                    Log.w(TAG, "fromTreeUri null for $rootTreeUri")
                    return emptyList()
                }
        Log.i(TAG, "scan root name=${root.name} uri=${root.uri} canRead=${root.canRead()}")
        val found = ArrayList<VaultRef>()
        walk(root, relativePath = "", depth = 0, into = found)
        Log.i(TAG, "scan done count=${found.size} names=${found.map { it.name }}")
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

        val signal = vaultSignal(dir)
        if (signal != null) {
            val name =
                dir.name?.ifBlank { null }
                    ?: relativePath.substringAfterLast('/').ifBlank { "Vault" }
            into.add(
                VaultRef(
                    name = name,
                    relativePath = relativePath,
                    score = signal,
                ),
            )
            Log.i(TAG, "vault hit path=$relativePath name=$name score=$signal")
            return // do not descend into vault internals
        }

        val children =
            try {
                dir.listFiles()
            } catch (e: Exception) {
                Log.w(TAG, "listFiles failed at $relativePath", e)
                return
            }

        Log.d(TAG, "list depth=$depth path=$relativePath children=${children.size}")

        for (child in children) {
            if (!child.isDirectory) continue
            val name = child.name ?: continue
            // Skip only known junk — do NOT skip all dot names here; listFiles
            // usually already hid them. Still skip Android/ system dirs.
            if (name.equals("Android", ignoreCase = true)) continue
            if (name == "." || name == "..") continue
            walk(
                child,
                relativePath = VaultPathJoin.join(relativePath, name),
                depth = depth + 1,
                into = into,
            )
        }
    }

    /**
     * @return score if [dir] looks like an Obsidian vault, else null.
     */
    fun vaultSignal(dir: DocumentFile): Int? {
        // 1) Explicit .obsidian lookup — works when listFiles hides dotfolders
        if (hasChildDirectory(dir, ".obsidian")) {
            var s = 10
            if (hasChildDirectory(dir, CaptureLine.SYSTEM_FOLDER)) s += 10
            if (hasChildDirectory(dir, "Atoms")) s += 3
            if (hasAtomsPlugin(dir)) s += 10
            return s
        }

        // 2) Atoms System folder is plugin-owned and not hidden
        if (hasChildDirectory(dir, CaptureLine.SYSTEM_FOLDER)) {
            var s = 8
            if (hasChildDirectory(dir, "Atoms")) s += 3
            return s
        }

        // 3) Flat Atoms/ folder with markdown (weak but useful)
        if (hasChildDirectory(dir, "Atoms") && hasMarkdownChild(dir)) {
            return 4
        }

        return null
    }

    private fun hasAtomsPlugin(vaultDir: DocumentFile): Boolean {
        val obsidian = findChildDirectory(vaultDir, ".obsidian") ?: return false
        val plugins = findChildDirectory(obsidian, "plugins") ?: return false
        return hasChildDirectory(plugins, "atoms")
    }

    private fun hasMarkdownChild(dir: DocumentFile): Boolean {
        return try {
            dir.listFiles().any { it.isFile && (it.name?.endsWith(".md", true) == true) }
        } catch (_: Exception) {
            false
        }
    }

    private fun hasChildDirectory(
        parent: DocumentFile,
        name: String,
    ): Boolean = findChildDirectory(parent, name) != null

    /**
     * Find a child directory by name. Prefer [DocumentFile.findFile], then a
     * DocumentsContract query, then a constructed document id
     * (`parentId/name`) — ExternalStorageProvider often omits `.obsidian` from
     * list results but still serves it by id.
     */
    private fun findChildDirectory(
        parent: DocumentFile,
        name: String,
    ): DocumentFile? {
        try {
            parent.findFile(name)?.let { child ->
                if (child.isDirectory || child.exists()) return child
            }
        } catch (e: Exception) {
            Log.d(TAG, "findFile($name) failed", e)
        }

        val parentUri = parent.uri
        val parentDocId = documentIdOf(parentUri) ?: return null

        // Query children (may still omit dot names on some builds)
        try {
            val childrenUri =
                DocumentsContract.buildChildDocumentsUriUsingTree(parentUri, parentDocId)
            context.contentResolver
                .query(
                    childrenUri,
                    arrayOf(
                        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                        DocumentsContract.Document.COLUMN_MIME_TYPE,
                    ),
                    null,
                    null,
                    null,
                )?.use { cursor ->
                    val idIdx = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
                    val nameIdx = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
                    val mimeIdx = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE)
                    while (cursor.moveToNext()) {
                        val display = cursor.getString(nameIdx) ?: continue
                        if (display != name) continue
                        val mime = cursor.getString(mimeIdx)
                        if (mime != null && mime != DocumentsContract.Document.MIME_TYPE_DIR) continue
                        val docId = cursor.getString(idIdx)
                        val childUri = DocumentsContract.buildDocumentUriUsingTree(parentUri, docId)
                        DocumentFile.fromSingleUri(context, childUri)?.let { return it }
                    }
                }
        } catch (e: Exception) {
            Log.d(TAG, "query children for $name failed", e)
        }

        // Construct id directly: primary:Documents/Remote Vault/.obsidian
        try {
            val childId = "$parentDocId/$name"
            val childUri = DocumentsContract.buildDocumentUriUsingTree(parentUri, childId)
            val child = DocumentFile.fromSingleUri(context, childUri)
            if (child != null && child.exists()) {
                Log.d(TAG, "found $name via constructed id=$childId")
                return child
            }
        } catch (e: Exception) {
            Log.d(TAG, "constructed id for $name failed", e)
        }

        return null
    }

    private fun documentIdOf(uri: Uri): String? {
        return try {
            if (DocumentsContract.isTreeUri(uri)) {
                // Tree uri may also carry a document suffix; prefer document id when present
                try {
                    DocumentsContract.getDocumentId(uri)
                } catch (_: IllegalArgumentException) {
                    DocumentsContract.getTreeDocumentId(uri)
                }
            } else {
                DocumentsContract.getDocumentId(uri)
            }
        } catch (e: Exception) {
            Log.d(TAG, "documentIdOf failed for $uri", e)
            null
        }
    }

    companion object {
        private const val TAG = "AtomsCaptureScan"
    }
}
