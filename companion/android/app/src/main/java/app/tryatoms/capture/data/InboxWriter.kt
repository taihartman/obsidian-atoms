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
import java.nio.file.Files
import java.nio.file.StandardCopyOption
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
            synchronized(WRITE_LOCK) {
                val existing = if (inbox.exists()) inbox.readText(StandardCharsets.UTF_8) else ""
                val merged = CaptureLine.mergeAppend(existing, formatted.line)
                atomicWriteText(inbox, merged)
            }
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

        return try {
            synchronized(WRITE_LOCK) {
                // Never treat a failed read as empty — that would truncate Inbox.md via "wt".
                val existing = readTextOrThrow(inbox.uri)
                if (existing.isEmpty()) {
                    val merged = CaptureLine.mergeAppend("", formatted.line)
                    writeSafFull(inbox.uri, merged)
                } else {
                    // Prefer append-only so a kill mid-write cannot truncate the inbox.
                    val line =
                        if (existing.endsWith("\n")) {
                            formatted.line + "\n"
                        } else {
                            "\n" + formatted.line + "\n"
                        }
                    appendSaf(inbox.uri, line)
                }
            }
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
            if (seg == ".." || seg == ".") return null
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

    /** Successful empty read is ""; open/read failure throws (never silent wipe). */
    private fun readTextOrThrow(uri: Uri): String {
        val input =
            context.contentResolver.openInputStream(uri)
                ?: error("Could not read Inbox.md")
        return input.use { stream ->
            BufferedReader(InputStreamReader(stream, StandardCharsets.UTF_8)).readText()
        }
    }

    private fun writeSafFull(
        uri: Uri,
        text: String,
    ) {
        context.contentResolver.openOutputStream(uri, "wt")?.use { out ->
            out.write(text.toByteArray(StandardCharsets.UTF_8))
            out.flush()
        } ?: error("Could not open Inbox.md for writing")
    }

    private fun appendSaf(
        uri: Uri,
        text: String,
    ) {
        // "wa" = write+append when the provider supports it
        context.contentResolver.openOutputStream(uri, "wa")?.use { out ->
            out.write(text.toByteArray(StandardCharsets.UTF_8))
            out.flush()
        } ?: run {
            // Fallback: full rewrite only after a successful read (still under WRITE_LOCK)
            val existing = readTextOrThrow(uri)
            writeSafFull(uri, existing + text)
        }
    }

    companion object {
        /** Process-wide lock so hub + overlay cannot interleave full rewrites. */
        private val WRITE_LOCK = Any()

        /**
         * Write via temp sibling + atomic move so a kill mid-write cannot leave a
         * truncated Inbox.md.
         */
        internal fun atomicWriteText(
            target: File,
            text: String,
        ) {
            val parent = target.parentFile ?: error("Inbox has no parent")
            val tmp = File(parent, ".${target.name}.tmp")
            tmp.writeText(text, StandardCharsets.UTF_8)
            try {
                Files.move(
                    tmp.toPath(),
                    target.toPath(),
                    StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE,
                )
            } catch (_: Exception) {
                // Some filesystems reject ATOMIC_MOVE — still replace via rename.
                if (!tmp.renameTo(target)) {
                    target.writeText(text, StandardCharsets.UTF_8)
                    tmp.delete()
                }
            }
        }
    }
}
