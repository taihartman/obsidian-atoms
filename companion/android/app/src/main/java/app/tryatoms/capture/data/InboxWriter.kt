package app.tryatoms.capture.data

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import app.tryatoms.capture.domain.CaptureLine
import app.tryatoms.capture.domain.VaultPathJoin
import java.io.BufferedReader
import java.io.File
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

    fun appendCaptureToVaultPath(
        vaultAbsolutePath: String,
        body: String,
        now: OffsetDateTime = OffsetDateTime.now(),
    ): WriteResult {
        val formatted =
            try {
                CaptureLine.format(body, now)
            } catch (e: IllegalArgumentException) {
                return WriteResult.Err(e.message ?: "Empty capture")
            }

        val vault = File(vaultAbsolutePath)
        if (!vault.isDirectory) {
            return WriteResult.Err("Vault folder missing: $vaultAbsolutePath")
        }

        val systemDir = File(vault, CaptureLine.SYSTEM_FOLDER)
        if (!systemDir.exists() && !systemDir.mkdirs()) {
            return WriteResult.Err("Could not create ${CaptureLine.SYSTEM_FOLDER}")
        }

        val inbox = File(systemDir, CaptureLine.INBOX_FILE_NAME)
        return try {
            val existing = if (inbox.exists()) inbox.readText(StandardCharsets.UTF_8) else ""
            val merged = CaptureLine.mergeAppend(existing, formatted.line)
            inbox.writeText(merged, StandardCharsets.UTF_8)
            okPreview(formatted.stamp, body)
        } catch (e: Exception) {
            WriteResult.Err(e.message ?: "Write failed")
        }
    }

    fun appendCapture(
        accessRootUri: Uri,
        vaultRelativePath: String,
        body: String,
        now: OffsetDateTime = OffsetDateTime.now(),
    ): WriteResult {
        val formatted =
            try {
                CaptureLine.format(body, now)
            } catch (e: IllegalArgumentException) {
                return WriteResult.Err(e.message ?: "Empty capture")
            }

        val root =
            DocumentFile.fromTreeUri(context, accessRootUri)
                ?: return WriteResult.Err("Could not open the linked folder")

        val vaultDir =
            resolveRelative(root, vaultRelativePath)
                ?: return WriteResult.Err("Could not open the vault folder. Pick it again.")

        if (!vaultDir.canRead() || !vaultDir.canWrite()) {
            return WriteResult.Err("No permission to write this folder. Link again.")
        }

        val systemFolder =
            findOrCreateDirectory(vaultDir, CaptureLine.SYSTEM_FOLDER)
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
            okPreview(formatted.stamp, body)
        } catch (e: Exception) {
            WriteResult.Err(e.message ?: "Write failed")
        }
    }

    private fun okPreview(
        stamp: String,
        body: String,
    ): WriteResult.Ok {
        val preview =
            body.trim().replace("\n", " ").let {
                if (it.length > 80) it.take(77) + "…" else it
            }
        return WriteResult.Ok(stamp = stamp, preview = preview)
    }

    fun resolveRelative(
        root: DocumentFile,
        relativePath: String,
    ): DocumentFile? {
        var dir = root
        for (seg in VaultPathJoin.segments(relativePath)) {
            dir = dir.findFile(seg)?.takeIf { it.isDirectory } ?: return null
        }
        return dir
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
        sequenceOf(name, baseName, "$baseName.md")
            .mapNotNull { parent.findFile(it) }
            .firstOrNull { it.isFile }
            ?.let { return it }

        val created =
            parent.createFile("text/markdown", baseName)
                ?: parent.createFile("text/plain", baseName)
                ?: return null
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
