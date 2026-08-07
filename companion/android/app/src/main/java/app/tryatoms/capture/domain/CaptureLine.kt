package app.tryatoms.capture.domain

import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Wire contract shared with the Obsidian plugin inbox drain.
 *
 * Shape: `- 2026-07-28T17:23:34-04:00 capture text`
 *
 * - ISO-8601 local datetime with colon offset and seconds
 * - Multiline body: newlines become tab-indented continuations
 * - Body is never rewritten beyond that whitespace rule
 *
 * See: docs/capture-shortcut.md, src/pipeline/inbox.ts
 */
object CaptureLine {
    const val SYSTEM_FOLDER = "Atoms System"
    const val INBOX_FILE_NAME = "Inbox.md"
    const val INBOX_RELATIVE_PATH = "$SYSTEM_FOLDER/$INBOX_FILE_NAME"

    /**
     * Header for a freshly created inbox note — same spirit as
     * INBOX_NOTE_TEMPLATE in the plugin (path is load-bearing).
     */
    val INBOX_NOTE_TEMPLATE: String =
        """
        |---
        |atoms-inbox: true
        |---
        |
        |Capture inbox. Atoms Capture appends here, and the Atoms plugin files
        |each line into the daily note for the day it was captured.
        |
        |Lines are marked once filed and are never deleted by Atoms.
        |
        |Do not move or rename this note — capture points at this exact path.
        |
        |
        """.trimMargin()

    private val STAMP_FORMATTER: DateTimeFormatter =
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX")

    data class Result(
        val line: String,
        val stamp: String,
    )

    fun format(
        body: String,
        now: OffsetDateTime = OffsetDateTime.now(ZoneId.systemDefault()),
    ): Result {
        val trimmed = body.trim()
        require(trimmed.isNotEmpty()) { "Capture text is empty" }

        val stamp = now.format(STAMP_FORMATTER)
        val normalizedBody = normalizeMultiline(trimmed)
        val line = "- $stamp $normalizedBody"
        return Result(line = line, stamp = stamp)
    }

    /** Newlines become tab-indented continuation lines (Shortcut recipe step 6). */
    fun normalizeMultiline(body: String): String =
        body.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\n\t")

    /**
     * Prepare file content for append: ensure trailing newline on existing body,
     * then add the new capture line and a final newline.
     */
    fun mergeAppend(
        existing: String,
        captureLine: String,
    ): String {
        val base =
            when {
                existing.isEmpty() -> INBOX_NOTE_TEMPLATE
                existing.endsWith("\n") -> existing
                else -> "$existing\n"
            }
        return base + captureLine + "\n"
    }
}
