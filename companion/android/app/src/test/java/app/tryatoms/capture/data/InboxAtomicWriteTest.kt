package app.tryatoms.capture.data

import app.tryatoms.capture.domain.CaptureLine
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.nio.charset.StandardCharsets
import java.time.OffsetDateTime
import java.time.ZoneOffset

class InboxAtomicWriteTest {
    @get:Rule
    val tmp = TemporaryFolder()

    @Test
    fun atomicWriteText_createsAndReplaces() {
        val target = tmp.newFile("Inbox.md")
        InboxWriter.atomicWriteText(target, "one\n")
        assertEquals("one\n", target.readText(StandardCharsets.UTF_8))
        InboxWriter.atomicWriteText(target, "two\n")
        assertEquals("two\n", target.readText(StandardCharsets.UTF_8))
        assertTrue(tmp.root.listFiles()?.none { it.name.endsWith(".tmp") } == true)
    }

    @Test
    fun mergeAppend_thenAtomicWrite_preservesPriorLine() {
        val vault = tmp.newFolder("MyVault")
        File(vault, ".obsidian").mkdirs()
        val system = File(vault, CaptureLine.SYSTEM_FOLDER).also { it.mkdirs() }
        val inbox = File(system, CaptureLine.INBOX_FILE_NAME)

        val t1 = OffsetDateTime.of(2026, 8, 7, 12, 0, 0, 0, ZoneOffset.ofHours(-4))
        val line1 = CaptureLine.format("first thought", t1)
        val merged1 = CaptureLine.mergeAppend("", line1.line)
        InboxWriter.atomicWriteText(inbox, merged1)

        val t2 = OffsetDateTime.of(2026, 8, 7, 12, 1, 0, 0, ZoneOffset.ofHours(-4))
        val line2 = CaptureLine.format("second thought", t2)
        val merged2 = CaptureLine.mergeAppend(inbox.readText(StandardCharsets.UTF_8), line2.line)
        InboxWriter.atomicWriteText(inbox, merged2)

        val text = inbox.readText(StandardCharsets.UTF_8)
        assertTrue(text.contains("first thought"))
        assertTrue(text.contains("second thought"))
        assertTrue(text.contains("atoms-inbox: true"))
    }
}
