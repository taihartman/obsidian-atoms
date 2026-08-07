package app.tryatoms.capture.data

import kotlin.test.Test
import kotlin.test.assertEquals

/** The direct-install build keeps the scan the folder picker replaces. */
class FileTreeAccessSideloadTest {
    @Test
    fun `sideload declares file tree support`() {
        assertEquals(true, FileTreeAccess.SUPPORTED)
    }
}
