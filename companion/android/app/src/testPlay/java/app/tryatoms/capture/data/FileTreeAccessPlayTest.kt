package app.tryatoms.capture.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The store build must not be able to scan the phone for vaults. */
class FileTreeAccessPlayTest {
    @Test
    fun `play declares no file tree support`() {
        assertEquals(false, FileTreeAccess.SUPPORTED)
    }

    @Test
    fun `play never reports the permission granted`() {
        assertEquals(false, FileTreeAccess.granted())
    }

    @Test
    fun `play discovers nothing`() {
        assertTrue(FileTreeAccess.discover().isEmpty())
    }
}
