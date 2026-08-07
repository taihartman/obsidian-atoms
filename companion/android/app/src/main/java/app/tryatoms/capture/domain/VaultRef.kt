package app.tryatoms.capture.domain

/**
 * A vault reachable under a user-granted SAF tree (usually Documents or storage root).
 *
 * [relativePath] is empty when the granted folder *is* the vault.
 * Otherwise segments joined with `/`, e.g. `Remote Vault` or `Notes/Work`.
 */
data class VaultRef(
    val name: String,
    val relativePath: String,
    val score: Int = 1,
) {
    val displayPath: String
        get() = relativePath.ifEmpty { name }
}

object VaultPathJoin {
    fun join(
        parent: String,
        child: String,
    ): String =
        when {
            parent.isEmpty() -> child
            child.isEmpty() -> parent
            else -> "$parent/$child"
        }

    fun segments(relativePath: String): List<String> =
        relativePath
            .split('/')
            .map { it.trim() }
            .filter { it.isNotEmpty() }
}
