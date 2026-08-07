package app.tryatoms.capture.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.OffsetDateTime
import java.time.ZoneOffset

class CaptureLineTest {
    private val fixed =
        OffsetDateTime.of(2026, 7, 28, 17, 23, 34, 0, ZoneOffset.ofHours(-4))

    @Test
    fun formatsStampWithColonOffsetAndSeconds() {
        val result = CaptureLine.format("hello", fixed)
        assertEquals("2026-07-28T17:23:34-04:00", result.stamp)
        assertEquals("- 2026-07-28T17:23:34-04:00 hello", result.line)
    }

    @Test
    fun rejectsEmptyBody() {
        try {
            CaptureLine.format("   ", fixed)
            throw AssertionError("expected empty reject")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("empty", ignoreCase = true))
        }
    }

    @Test
    fun multilineBecomesTabContinuations() {
        val result = CaptureLine.format("line one\nline two\nline three", fixed)
        assertEquals(
            "- 2026-07-28T17:23:34-04:00 line one\n\tline two\n\tline three",
            result.line,
        )
    }

    @Test
    fun positiveOffsetUsesColon() {
        val tokyoish = OffsetDateTime.of(2026, 8, 7, 9, 0, 1, 0, ZoneOffset.ofHours(9))
        val result = CaptureLine.format("hi", tokyoish)
        assertEquals("2026-08-07T09:00:01+09:00", result.stamp)
        assertFalse("must not use Z-style -0400", result.stamp.matches(Regex(".*[+-]\\d{4}$")))
    }

    @Test
    fun mergeAppendCreatesTemplateWhenEmpty() {
        val merged = CaptureLine.mergeAppend("", "- 2026-07-28T17:23:34-04:00 first")
        assertTrue(merged.contains("atoms-inbox: true"))
        assertTrue(merged.endsWith("- 2026-07-28T17:23:34-04:00 first\n"))
        assertTrue(merged.contains("Atoms System") || merged.contains("Capture inbox"))
    }

    @Test
    fun mergeAppendAddsNewlineWhenMissing() {
        val merged = CaptureLine.mergeAppend("existing", "- 2026-07-28T17:23:34-04:00 next")
        assertEquals("existing\n- 2026-07-28T17:23:34-04:00 next\n", merged)
    }

    @Test
    fun mergeAppendKeepsExistingTrailingNewline() {
        val merged = CaptureLine.mergeAppend("existing\n", "- 2026-07-28T17:23:34-04:00 next")
        assertEquals("existing\n- 2026-07-28T17:23:34-04:00 next\n", merged)
    }

    @Test
    fun pathConstantsMatchPlugin() {
        assertEquals("Atoms System", CaptureLine.SYSTEM_FOLDER)
        assertEquals("Inbox.md", CaptureLine.INBOX_FILE_NAME)
        assertEquals("Atoms System/Inbox.md", CaptureLine.INBOX_RELATIVE_PATH)
    }
}
