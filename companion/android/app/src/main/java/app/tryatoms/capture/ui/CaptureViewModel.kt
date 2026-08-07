package app.tryatoms.capture.ui

import android.app.Application
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.tryatoms.capture.data.InboxWriter
import app.tryatoms.capture.data.SafVaultScanner
import app.tryatoms.capture.data.VaultStore
import app.tryatoms.capture.domain.VaultRef
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class CaptureUiState(
    val draft: String = "",
    val vaultLinked: Boolean = false,
    val vaultName: String? = null,
    val firstCaptureDone: Boolean = false,
    val lastStatus: String? = null,
    val busy: Boolean = false,
    val banner: String? = null,
    val bannerIsError: Boolean = false,
    val listedVaults: List<VaultRef> = emptyList(),
    val hasAccessRoot: Boolean = false,
    val scanning: Boolean = false,
)

class CaptureViewModel(
    app: Application,
) : AndroidViewModel(app) {
    private val store = VaultStore(app)
    private val writer = InboxWriter(app)
    private val safScanner = SafVaultScanner(app)

    private val draft = MutableStateFlow("")
    private val busy = MutableStateFlow(false)
    private val banner = MutableStateFlow<Pair<String, Boolean>?>(null)
    private val listed = MutableStateFlow<List<VaultRef>>(emptyList())
    private val scanning = MutableStateFlow(false)

    private data class Transient(
        val draft: String,
        val busy: Boolean,
        val banner: Pair<String, Boolean>?,
        val listed: List<VaultRef>,
        val scanning: Boolean,
    )

    private val transient =
        combine(draft, busy, banner, listed, scanning) { d, b, ban, list, scan ->
            Transient(d, b, ban, list, scan)
        }

    val uiState: StateFlow<CaptureUiState> =
        combine(store.state, transient) { vault, t ->
            CaptureUiState(
                draft = t.draft,
                vaultLinked = vault.vaultLinked,
                vaultName = vault.vaultName,
                firstCaptureDone = vault.firstCaptureDone,
                lastStatus = vault.lastStatus,
                busy = t.busy,
                banner = t.banner?.first,
                bannerIsError = t.banner?.second == true,
                listedVaults = t.listed,
                hasAccessRoot = vault.accessRootUri != null,
                scanning = t.scanning,
            )
        }.stateIn(
            viewModelScope,
            SharingStarted.Eagerly,
            CaptureUiState(
                vaultLinked = store.current().vaultLinked,
                vaultName = store.current().vaultName,
                firstCaptureDone = store.current().firstCaptureDone,
                lastStatus = store.current().lastStatus,
                hasAccessRoot = store.current().accessRootUri != null,
            ),
        )

    init {
        restoreFromSystemGrants()
        // Re-list vaults under a saved root so multi-vault chooser comes back after restart
        store.current().accessRootUri?.let { root ->
            viewModelScope.launch { scanRoot(root, autoSelectSingle = !store.current().vaultLinked) }
        }
    }

    fun onDraftChange(value: String) {
        draft.value = value
    }

    fun clearBanner() {
        banner.value = null
    }

    fun onPickerCancelled() {
        banner.value =
            "Folder picker closed without a choice. Tap Find my vaults again, " +
            "open Documents (or your vault), then tap Use this folder." to true
    }

    fun onAccessRootPicked(uri: Uri) {
        viewModelScope.launch {
            val cr = getApplication<Application>().contentResolver
            val flags =
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            try {
                cr.takePersistableUriPermission(uri, flags)
                Log.i(TAG, "persistable grant ok uri=$uri")
            } catch (e: SecurityException) {
                Log.e(TAG, "takePersistableUriPermission failed", e)
                banner.value =
                    "Could not keep folder access (${e.message}). Try Find my vaults again." to true
                return@launch
            }

            store.setAccessRoot(uri)
            scanRoot(uri, autoSelectSingle = true)
        }
    }

    fun selectVault(ref: VaultRef) {
        val root = store.current().accessRootUri
        if (root == null) {
            banner.value = "Grant a folder first (Find my vaults)." to true
            return
        }
        store.setSelectedVault(ref.relativePath, ref.name)
        banner.value =
            "Using ${ref.name}. Captures go to Atoms System/Inbox.md." to false
    }

    fun useAccessRootAsVault() {
        val root = store.current().accessRootUri ?: return
        val name = guessName(root) ?: "Vault"
        store.setVaultAsRoot(root, name)
        listed.value = listOf(VaultRef(name = name, relativePath = "", score = 1))
        banner.value = "Using $name as your vault." to false
    }

    fun rescanListedVaults() {
        val root = store.current().accessRootUri ?: return
        viewModelScope.launch { scanRoot(root, autoSelectSingle = false) }
    }

    fun unlinkVault() {
        store.clearVaultLink()
        listed.value = emptyList()
        banner.value = "Vault unlinked." to false
    }

    fun capture() {
        val vault = store.current()
        val root = vault.accessRootUri
        val rel = vault.vaultRelativePath
        if (root == null || rel == null) {
            banner.value = "Choose a vault first." to true
            return
        }
        if (draft.value.isBlank()) {
            banner.value = "Type something first." to true
            return
        }
        if (busy.value) return

        viewModelScope.launch {
            busy.value = true
            banner.value = null
            val text = draft.value
            val result =
                withContext(Dispatchers.IO) {
                    writer.appendCapture(root, rel, text)
                }
            when (result) {
                is InboxWriter.WriteResult.Ok -> {
                    draft.value = ""
                    val status = "Saved · ${result.stamp} · ${result.preview}"
                    store.markCaptureDone(status)
                    banner.value =
                        "Saved to Inbox.md. Open Obsidian when you can — Atoms files it into your daily." to false
                }
                is InboxWriter.WriteResult.Err -> {
                    store.setLastStatus("Failed · ${result.message}")
                    banner.value = result.message to true
                }
            }
            busy.value = false
        }
    }

    private suspend fun scanRoot(
        uri: Uri,
        autoSelectSingle: Boolean,
    ) {
        scanning.value = true
        val vaults =
            withContext(Dispatchers.IO) {
                safScanner.listVaults(uri)
            }
        listed.value = vaults
        scanning.value = false
        Log.i(TAG, "scanRoot count=${vaults.size} auto=$autoSelectSingle")

        when {
            vaults.isEmpty() -> {
                banner.value =
                    "No vaults found there. Pick Documents (parent of your vaults), " +
                    "or open the vault folder and tap Use this folder as vault." to true
            }
            vaults.size == 1 && autoSelectSingle -> {
                val v = vaults.first()
                store.setAccessRootAndVault(uri, v.relativePath, v.name)
                banner.value =
                    "Linked ${v.name}. Captures go to Atoms System/Inbox.md." to false
            }
            store.current().vaultLinked -> {
                // keep existing selection
            }
            else -> {
                banner.value =
                    "Found ${vaults.size} vaults — pick which one to capture into." to false
            }
        }
    }

    private fun restoreFromSystemGrants() {
        val cr = getApplication<Application>().contentResolver
        val grants =
            try {
                cr.persistedUriPermissions
                    .filter { it.isReadPermission && it.isWritePermission }
                    .map { it.uri }
            } catch (e: Exception) {
                Log.w(TAG, "persistedUriPermissions failed", e)
                emptyList()
            }
        Log.i(TAG, "system grants=${grants.size} $grants")
        if (grants.isNotEmpty()) {
            store.restoreRootIfMissing(grants)
        }
    }

    private fun guessName(treeUri: Uri): String? {
        return try {
            val docId =
                try {
                    DocumentsContract.getDocumentId(treeUri)
                } catch (_: IllegalArgumentException) {
                    DocumentsContract.getTreeDocumentId(treeUri)
                }
            docId.substringAfterLast(':').substringAfterLast('/')
        } catch (_: Exception) {
            null
        }
    }

    companion object {
        private const val TAG = "AtomsCaptureVM"
    }
}
