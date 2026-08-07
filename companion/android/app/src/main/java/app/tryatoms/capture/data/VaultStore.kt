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
    private val treeUriKey = stringPreferencesKey("vault_tree_uri")
    private val captureDoneKey = booleanPreferencesKey("first_capture_done")
    private val lastStatusKey = stringPreferencesKey("last_status")

    data class State(
        val treeUri: Uri? = null,
        val firstCaptureDone: Boolean = false,
        val lastStatus: String? = null,
    )

    val state: Flow<State> =
        context.dataStore.data.map { prefs ->
            val uriStr = prefs[treeUriKey]
            State(
                treeUri = uriStr?.let { Uri.parse(it) },
                firstCaptureDone = prefs[captureDoneKey] == true,
                lastStatus = prefs[lastStatusKey],
            )
        }

    suspend fun setTreeUri(uri: Uri) {
        context.dataStore.edit { prefs ->
            prefs[treeUriKey] = uri.toString()
        }
    }

    suspend fun clearTreeUri() {
        context.dataStore.edit { prefs ->
            prefs.remove(treeUriKey)
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
