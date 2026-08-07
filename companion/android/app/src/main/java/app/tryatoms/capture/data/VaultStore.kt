package app.tryatoms.capture.data

import android.content.Context
import android.net.Uri
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "atoms_capture")

class VaultStore(
    private val context: Context,
) {
    private val accessRootUriKey = stringPreferencesKey("access_root_tree_uri")
    private val vaultRelativePathKey = stringPreferencesKey("vault_relative_path")
    private val vaultNameKey = stringPreferencesKey("vault_name")
    private val captureDoneKey = booleanPreferencesKey("first_capture_done")
    private val lastStatusKey = stringPreferencesKey("last_status")

    /** Legacy single-tree key from first POC — migrated on read. */
    private val legacyTreeUriKey = stringPreferencesKey("vault_tree_uri")

    data class State(
        /** SAF tree the user granted (Documents, storage, or the vault itself). */
        val accessRootUri: Uri? = null,
        /** Path under [accessRootUri] to the vault folder; empty = root is the vault. */
        val vaultRelativePath: String? = null,
        val vaultName: String? = null,
        val firstCaptureDone: Boolean = false,
        val lastStatus: String? = null,
    ) {
        val vaultLinked: Boolean
            get() = accessRootUri != null && vaultRelativePath != null
    }

    val state: Flow<State> =
        context.dataStore.data.map { prefs ->
            var root = prefs[accessRootUriKey]?.let { Uri.parse(it) }
            var rel = prefs[vaultRelativePathKey]
            var name = prefs[vaultNameKey]

            // Migrate POC v1: vault tree URI only → treat as root-is-vault
            if (root == null) {
                val legacy = prefs[legacyTreeUriKey]
                if (legacy != null) {
                    root = Uri.parse(legacy)
                    rel = rel ?: ""
                    name = name ?: "Vault"
                }
            }

            State(
                accessRootUri = root,
                vaultRelativePath = rel,
                vaultName = name,
                firstCaptureDone = prefs[captureDoneKey] == true,
                lastStatus = prefs[lastStatusKey],
            )
        }

    suspend fun setAccessRoot(uri: Uri) {
        context.dataStore.edit { prefs ->
            prefs[accessRootUriKey] = uri.toString()
            // Choosing a new root clears vault selection until the user picks one
            prefs.remove(vaultRelativePathKey)
            prefs.remove(vaultNameKey)
            prefs.remove(legacyTreeUriKey)
        }
    }

    suspend fun setSelectedVault(
        relativePath: String,
        name: String,
    ) {
        context.dataStore.edit { prefs ->
            prefs[vaultRelativePathKey] = relativePath
            prefs[vaultNameKey] = name
            prefs.remove(legacyTreeUriKey)
        }
    }

    /** Direct vault folder grant (picker landed on the vault itself). */
    suspend fun setVaultAsRoot(
        uri: Uri,
        name: String,
    ) {
        context.dataStore.edit { prefs ->
            prefs[accessRootUriKey] = uri.toString()
            prefs[vaultRelativePathKey] = ""
            prefs[vaultNameKey] = name
            prefs.remove(legacyTreeUriKey)
        }
    }

    suspend fun clearVaultLink() {
        context.dataStore.edit { prefs ->
            prefs.remove(accessRootUriKey)
            prefs.remove(vaultRelativePathKey)
            prefs.remove(vaultNameKey)
            prefs.remove(legacyTreeUriKey)
        }
    }

    suspend fun markCaptureDone(status: String) {
        context.dataStore.edit { prefs ->
            prefs[captureDoneKey] = true
            prefs[lastStatusKey] = status
        }
    }

    suspend fun setLastStatus(status: String) {
        context.dataStore.edit { prefs ->
            prefs[lastStatusKey] = status
        }
    }
}
