package app.tryatoms.capture.data

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import app.tryatoms.capture.domain.CaptureLine
import java.io.BufferedReader
import java.io.InputStreamReader
import java.nio.charset.StandardCharsets
import java.time.OffsetDateTime

class InboxWriter(
    private val context: Context,
) {
    sealed class WriteResult {
        data class Ok(
            val stamp: String,
            val preview: String,
        ) : WriteResult()

        data class Err(
            val message: String,
        ) : WriteResult()
    }

    fun appendCapture(
        treeUri: Uri,
        body: String,
        now: OffsetDateTime = OffsetDateTime.now(),
    ): WriteResult {
        val formatted =
            try {
                CaptureLine.format(body, now)
            } catch (e: IllegalArgumentException) {
                return WriteResult.Err(e.message ?: "Empty capture")
            }

        val tree =
            DocumentFile.fromTreeUri(context, treeUri)
                ?: return WriteResult.Err("Could not open the vault folder")

        if (!tree.canRead() || !tree.canWrite()) {
            return WriteResult.Err("No permission to write this folder. Link the vault again.")
        }

        val systemFolder =
            findOrCreateDirectory(tree, CaptureLine.SYSTEM_FOLDER)
                ?: return WriteResult.Err("Could not create ${CaptureLine.SYSTEM_FOLDER}")

        val inbox =
            findOrCreateFile(systemFolder, CaptureLine.INBOX_FILE_NAME)
                ?: return WriteResult.Err("Could not create ${CaptureLine.INBOX_FILE_NAME}")

        val existing = readText(inbox.uri)
        val merged = CaptureLine.mergeAppend(existing, formatted.line)

        return try {
            context.contentResolver.openOutputStream(inbox.uri, "wt")?.use { out ->
                out.write(merged.toByteArray(StandardCharsets.UTF_8))
                out.flush()
            } ?: return WriteResult.Err("Could not open Inbox.md for writing")

            val preview =
                body.trim().replace("\n", " ").let {
                    if (it.length > 80) it.take(77) + "…" else it
                }
            WriteResult.Ok(stamp = formatted.stamp, preview = preview)
        } catch (e: Exception) {
            WriteResult.Err(e.message ?: "Write failed")
        }
    }

    private fun findOrCreateDirectory(
        parent: DocumentFile,
        name: String,
    ): DocumentFile? {
        parent.findFile(name)?.let { existing ->
            if (existing.isDirectory) return existing
        }
        return parent.createDirectory(name)
    }

    private fun findOrCreateFile(
        parent: DocumentFile,
        name: String,
    ): DocumentFile? {
        val baseName = name.removeSuffix(".md")
        // Providers disagree on whether the extension is in the display name.
        sequenceOf(name, baseName, "$baseName.md")
            .mapNotNull { parent.findFile(it) }
            .firstOrNull { it.isFile }
            ?.let { return it }

        val created =
            parent.createFile("text/markdown", baseName)
                ?: parent.createFile("text/plain", baseName)
                ?: return null
        // If the provider ignored our name, rename is not always available — prefer
        // finding Inbox.md after create; otherwise use whatever was created.
        return sequenceOf(name, baseName, "$baseName.md")
            .mapNotNull { parent.findFile(it) }
            .firstOrNull { it.isFile }
            ?: created
    }

    private fun readText(uri: Uri): String {
        return try {
            context.contentResolver.openInputStream(uri)?.use { input ->
                BufferedReader(InputStreamReader(input, StandardCharsets.UTF_8)).readText()
            } ?: ""
        } catch (_: Exception) {
            ""
        }
    }
}
