package app.tryatoms.capture.data

import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * Vault link prefs. SharedPreferences (not DataStore) so a grant survives
 * process death reliably on the POC — we previously lost in-session links
 * because nothing durable was on disk after installs/restarts.
 */
class VaultStore(
    context: Context,
) {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private val _state = MutableStateFlow(read())
    val state: StateFlow<State> = _state.asStateFlow()

    data class State(
        val accessRootUri: Uri? = null,
        /** Empty string = granted folder is the vault. null = no vault chosen yet. */
        val vaultRelativePath: String? = null,
        val vaultName: String? = null,
        val firstCaptureDone: Boolean = false,
        val lastStatus: String? = null,
    ) {
        val vaultLinked: Boolean
            get() = accessRootUri != null && vaultRelativePath != null
    }

    fun current(): State = _state.value

    private fun read(): State {
        val root = prefs.getString(KEY_ROOT, null)?.let { Uri.parse(it) }
        val rel =
            if (prefs.contains(KEY_REL)) {
                prefs.getString(KEY_REL, "") ?: ""
            } else {
                null
            }
        return State(
            accessRootUri = root,
            vaultRelativePath = rel,
            vaultName = prefs.getString(KEY_NAME, null),
            firstCaptureDone = prefs.getBoolean(KEY_CAPTURE_DONE, false),
            lastStatus = prefs.getString(KEY_STATUS, null),
        ).also {
            Log.i(TAG, "read linked=${it.vaultLinked} root=${it.accessRootUri} rel=${it.vaultRelativePath} name=${it.vaultName}")
        }
    }

    private fun write(block: SharedPreferences.Editor.() -> Unit) {
        prefs.edit().apply {
            block()
            commit() // durable before UI continues — apply() raced process death
        }
        _state.value = read()
    }

    fun setAccessRoot(uri: Uri) {
        val same = _state.value.accessRootUri == uri
        write {
            putString(KEY_ROOT, uri.toString())
            if (!same) {
                remove(KEY_REL)
                remove(KEY_NAME)
            }
        }
        Log.i(TAG, "setAccessRoot same=$same uri=$uri")
    }

    fun setSelectedVault(
        relativePath: String,
        name: String,
    ) {
        write {
            putString(KEY_REL, relativePath)
            putString(KEY_NAME, name)
        }
        Log.i(TAG, "setSelectedVault name=$name rel=$relativePath")
    }

    /** One atomic write: root + vault (avoids empty state between two edits). */
    fun setAccessRootAndVault(
        uri: Uri,
        relativePath: String,
        name: String,
    ) {
        write {
            putString(KEY_ROOT, uri.toString())
            putString(KEY_REL, relativePath)
            putString(KEY_NAME, name)
        }
        Log.i(TAG, "setAccessRootAndVault name=$name rel=$relativePath uri=$uri")
    }

    fun setVaultAsRoot(
        uri: Uri,
        name: String,
    ) {
        setAccessRootAndVault(uri, "", name)
    }

    fun clearVaultLink() {
        write {
            remove(KEY_ROOT)
            remove(KEY_REL)
            remove(KEY_NAME)
        }
        Log.i(TAG, "clearVaultLink")
    }

    fun markCaptureDone(status: String) {
        write {
            putBoolean(KEY_CAPTURE_DONE, true)
            putString(KEY_STATUS, status)
        }
    }

    fun setLastStatus(status: String) {
        write {
            putString(KEY_STATUS, status)
        }
    }

    /** Restore root URI from OS-persisted grants after prefs were wiped. */
    fun restoreRootIfMissing(candidates: List<Uri>) {
        if (_state.value.accessRootUri != null) return
        val first = candidates.firstOrNull() ?: return
        write {
            putString(KEY_ROOT, first.toString())
        }
        Log.i(TAG, "restoreRootIfMissing uri=$first")
    }

    companion object {
        private const val TAG = "AtomsCaptureStore"
        private const val PREFS = "atoms_capture"
        private const val KEY_ROOT = "access_root_tree_uri"
        private const val KEY_REL = "vault_relative_path"
        private const val KEY_NAME = "vault_name"
        private const val KEY_CAPTURE_DONE = "first_capture_done"
        private const val KEY_STATUS = "last_status"
    }
}
