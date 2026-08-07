package app.tryatoms.capture.domain

import org.junit.Assert.assertEquals
import org.junit.Test

class VaultRefTest {
    @Test
    fun joinPaths() {
        assertEquals("Remote Vault", VaultPathJoin.join("", "Remote Vault"))
        assertEquals("a/b", VaultPathJoin.join("a", "b"))
        assertEquals("a", VaultPathJoin.join("a", ""))
    }

    @Test
    fun segmentsSkipEmpties() {
        assertEquals(listOf("Remote Vault"), VaultPathJoin.segments("Remote Vault"))
        assertEquals(listOf("Notes", "Work"), VaultPathJoin.segments("Notes/Work"))
        assertEquals(emptyList<String>(), VaultPathJoin.segments(""))
        assertEquals(listOf("a", "b"), VaultPathJoin.segments("/a//b/"))
    }
}
