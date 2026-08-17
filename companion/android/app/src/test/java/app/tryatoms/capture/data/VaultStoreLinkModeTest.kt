package app.tryatoms.capture.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Older installs stored an absolute vault path from an all-files scan. This app
 * no longer has that permission, so a leftover path must not count as linked.
 */
class VaultStoreLinkModeTest {
    @Test
    fun `a stored path is dropped so the hub asks for a folder`() {
        val inherited = "/storage/emulated/0/Documents/Remote Vault"
        assertNull(VaultStore.linkedAbsolutePath(inherited))

        val state =
            VaultStore.State(
                vaultAbsolutePath = VaultStore.linkedAbsolutePath(inherited),
            )
        assertEquals(false, state.vaultLinked)
        assertEquals(false, state.usesFilePath)
    }

    @Test
    fun `a blank stored path stays null`() {
        assertNull(VaultStore.linkedAbsolutePath(null))
        assertNull(VaultStore.linkedAbsolutePath(""))
    }
}
