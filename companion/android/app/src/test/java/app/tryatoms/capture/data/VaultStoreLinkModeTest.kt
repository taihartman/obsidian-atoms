package app.tryatoms.capture.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Both flavors share an applicationId, so the Play build can be installed over a
 * sideload one and inherit its prefs. A file-path link survives that upgrade but
 * the permission behind it does not, and honoring it reported a linked vault
 * that failed every capture.
 */
class VaultStoreLinkModeTest {
    @Test
    fun `a stored path is kept where the build can read file paths`() {
        assertEquals(
            "/storage/emulated/0/Documents/Remote Vault",
            VaultStore.linkedAbsolutePath(
                "/storage/emulated/0/Documents/Remote Vault",
                fileTreeSupported = true,
            ),
        )
    }

    @Test
    fun `a stored path is dropped where the build cannot read file paths`() {
        assertNull(
            VaultStore.linkedAbsolutePath(
                "/storage/emulated/0/Documents/Remote Vault",
                fileTreeSupported = false,
            ),
        )
    }

    @Test
    fun `a dropped path leaves the vault unlinked, so the hub asks for a folder`() {
        val inherited = "/storage/emulated/0/Documents/Remote Vault"
        val playState =
            VaultStore.State(
                vaultAbsolutePath =
                    VaultStore.linkedAbsolutePath(inherited, fileTreeSupported = false),
            )
        assertEquals(false, playState.vaultLinked)
        assertEquals(false, playState.usesFilePath)

        val sideloadState =
            VaultStore.State(
                vaultAbsolutePath =
                    VaultStore.linkedAbsolutePath(inherited, fileTreeSupported = true),
            )
        assertEquals(true, sideloadState.vaultLinked)
        assertEquals(true, sideloadState.usesFilePath)
    }
}
