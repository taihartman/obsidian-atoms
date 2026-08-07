package app.tryatoms.capture.data

import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import android.util.Log

/**
 * Vault link prefs — SharedPreferences with commit() so grants survive restart.
 *
 * Two link modes:
 * - **File path**: absolute vault path after an all-files scan. Sideload only.
 * - **SAF**: tree URI + relative path. The only mode the Play build has.
 *
 * Both flavors share an applicationId, so installing the Play build over a
 * sideload one inherits its prefs. A file-path link there would read as linked
 * while every capture failed, so [linkedAbsolutePath] drops it and the hub asks
 * for a folder instead.
 */
class VaultStore(
    context: Context,
) {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private val _state = kotlinx.coroutines.flow.MutableStateFlow(read())
    val state: kotlinx.coroutines.flow.StateFlow<State> = _state

    data class State(
        /** Absolute filesystem path to the vault root (file mode). */
        val vaultAbsolutePath: String? = null,
        val accessRootUri: Uri? = null,
        val vaultRelativePath: String? = null,
        val vaultName: String? = null,
        val firstCaptureDone: Boolean = false,
        val shadeTileAdded: Boolean = false,
        val homeWidgetAdded: Boolean = false,
        val lastStatus: String? = null,
    ) {
        val vaultLinked: Boolean
            get() =
                !vaultAbsolutePath.isNullOrBlank() ||
                    (accessRootUri != null && vaultRelativePath != null)

        val usesFilePath: Boolean
            get() = !vaultAbsolutePath.isNullOrBlank()
    }

    fun current(): State = _state.value

    private fun read(): State {
        return State(
            vaultAbsolutePath =
                linkedAbsolutePath(prefs.getString(KEY_ABS, null), FileTreeAccess.SUPPORTED),
            accessRootUri = prefs.getString(KEY_ROOT, null)?.let { Uri.parse(it) },
            vaultRelativePath =
                if (prefs.contains(KEY_REL)) {
                    prefs.getString(KEY_REL, "") ?: ""
                } else {
                    null
                },
            vaultName = prefs.getString(KEY_NAME, null),
            firstCaptureDone = prefs.getBoolean(KEY_CAPTURE_DONE, false),
            shadeTileAdded = prefs.getBoolean(KEY_SHADE_TILE, false),
            homeWidgetAdded = prefs.getBoolean(KEY_HOME_WIDGET, false),
            lastStatus = prefs.getString(KEY_STATUS, null),
        ).also {
            Log.i(
                TAG,
                "read linked=${it.vaultLinked} file=${it.vaultAbsolutePath} name=${it.vaultName}",
            )
        }
    }

    private fun write(block: SharedPreferences.Editor.() -> Unit) {
        prefs.edit().apply {
            block()
            commit()
        }
        _state.value = read()
    }

    fun setFileVault(
        absolutePath: String,
        name: String,
    ) {
        write {
            putString(KEY_ABS, absolutePath)
            putString(KEY_NAME, name)
            remove(KEY_ROOT)
            remove(KEY_REL)
        }
        Log.i(TAG, "setFileVault name=$name path=$absolutePath")
    }

    fun setAccessRoot(uri: Uri) {
        val same = _state.value.accessRootUri == uri
        write {
            putString(KEY_ROOT, uri.toString())
            remove(KEY_ABS)
            if (!same) {
                remove(KEY_REL)
                remove(KEY_NAME)
            }
        }
    }

    fun setSelectedVault(
        relativePath: String,
        name: String,
    ) {
        write {
            putString(KEY_REL, relativePath)
            putString(KEY_NAME, name)
            remove(KEY_ABS)
        }
    }

    fun setAccessRootAndVault(
        uri: Uri,
        relativePath: String,
        name: String,
    ) {
        write {
            putString(KEY_ROOT, uri.toString())
            putString(KEY_REL, relativePath)
            putString(KEY_NAME, name)
            remove(KEY_ABS)
        }
    }

    fun setVaultAsRoot(
        uri: Uri,
        name: String,
    ) {
        setAccessRootAndVault(uri, "", name)
    }

    fun clearVaultLink() {
        write {
            remove(KEY_ABS)
            remove(KEY_ROOT)
            remove(KEY_REL)
            remove(KEY_NAME)
        }
    }

    fun markCaptureDone(status: String) {
        write {
            putBoolean(KEY_CAPTURE_DONE, true)
            putString(KEY_STATUS, status)
        }
    }

    fun markShadeTileAdded() {
        write { putBoolean(KEY_SHADE_TILE, true) }
    }

    fun markHomeWidgetAdded() {
        write { putBoolean(KEY_HOME_WIDGET, true) }
    }

    fun setLastStatus(status: String) {
        write {
            putString(KEY_STATUS, status)
        }
    }

    fun restoreRootIfMissing(candidates: List<Uri>) {
        if (_state.value.accessRootUri != null || _state.value.vaultAbsolutePath != null) return
        val first = candidates.firstOrNull() ?: return
        write {
            putString(KEY_ROOT, first.toString())
        }
    }

    companion object {
        /**
         * A stored absolute path counts as a link only where the build can read
         * one. Without all-files access the path is unreadable, so honoring it
         * would report a linked vault that silently swallowed every capture.
         */
        fun linkedAbsolutePath(
            stored: String?,
            fileTreeSupported: Boolean,
        ): String? = if (fileTreeSupported) stored else null

        private const val TAG = "AtomsCaptureStore"
        private const val PREFS = "atoms_capture"
        private const val KEY_ABS = "vault_absolute_path"
        private const val KEY_ROOT = "access_root_tree_uri"
        private const val KEY_REL = "vault_relative_path"
        private const val KEY_NAME = "vault_name"
        private const val KEY_CAPTURE_DONE = "first_capture_done"
        private const val KEY_SHADE_TILE = "shade_tile_added"
        private const val KEY_HOME_WIDGET = "home_widget_added"
        private const val KEY_STATUS = "last_status"
    }
}
