package app.tryatoms.capture.data

import app.tryatoms.capture.domain.DiscoveredVault

/**
 * Play build: there is no file-tree scan.
 *
 * The store flavor declares no MANAGE_EXTERNAL_STORAGE, so the only way to a
 * vault is the SAF folder picker. [VaultLocator] does not exist in this source
 * set at all — a caller that tries to scan the phone will not compile.
 */
object FileTreeAccess {
    const val SUPPORTED: Boolean = false

    fun granted(): Boolean = false

    fun discover(): List<DiscoveredVault> = emptyList()
}
