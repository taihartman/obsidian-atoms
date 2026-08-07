package app.tryatoms.capture.ui

import android.app.Application
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.tryatoms.capture.data.CaptureRepository
import app.tryatoms.capture.data.FileTreeAccess
import app.tryatoms.capture.data.InboxWriter
import app.tryatoms.capture.data.SafVaultScanner
import app.tryatoms.capture.data.VaultStore
import app.tryatoms.capture.domain.DiscoveredVault
import app.tryatoms.capture.domain.VaultRef
import app.tryatoms.capture.widget.CaptureHomeWidget
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
    val shadeTileAdded: Boolean = false,
    val homeWidgetAdded: Boolean = false,
    val lastStatus: String? = null,
    val busy: Boolean = false,
    val banner: String? = null,
    val bannerIsError: Boolean = false,
    val discoveredVaults: List<DiscoveredVault> = emptyList(),
    val listedVaults: List<VaultRef> = emptyList(),
    val hasAccessRoot: Boolean = false,
    val hasAllFilesAccess: Boolean = false,
    /** False in the Play build, which has no all-files permission to offer. */
    val fileScanSupported: Boolean = FileTreeAccess.SUPPORTED,
    val scanning: Boolean = false,
)

class CaptureViewModel(
    app: Application,
) : AndroidViewModel(app) {
    private val repo = CaptureRepository(app)
    private val store = repo.store()
    private val safScanner = SafVaultScanner(app)

    private val draft = MutableStateFlow("")
    private val busy = MutableStateFlow(false)
    private val banner = MutableStateFlow<Pair<String, Boolean>?>(null)
    private val discovered = MutableStateFlow<List<DiscoveredVault>>(emptyList())
    private val listed = MutableStateFlow<List<VaultRef>>(emptyList())
    private val scanning = MutableStateFlow(false)
    private val allFiles = MutableStateFlow(FileTreeAccess.granted())

    private data class UiBits(
        val draft: String,
        val busy: Boolean,
        val banner: Pair<String, Boolean>?,
        val discovered: List<DiscoveredVault>,
        val listed: List<VaultRef>,
        val scanning: Boolean,
        val allFiles: Boolean,
    )

    private val bitsA =
        combine(draft, busy, banner, discovered, listed) { d, b, ban, disc, list ->
            Triple(d, b, ban) to (disc to list)
        }
    private val bitsB = combine(scanning, allFiles) { s, a -> s to a }

    private val bits =
        combine(bitsA, bitsB) { a, b ->
            val (dbg, discList) = a
            val (d, busyV, ban) = dbg
            val (disc, list) = discList
            val (scan, af) = b
            UiBits(d, busyV, ban, disc, list, scan, af)
        }

    val uiState: StateFlow<CaptureUiState> =
        combine(store.state, bits) { vault, t ->
            CaptureUiState(
                draft = t.draft,
                vaultLinked = vault.vaultLinked,
                vaultName = vault.vaultName,
                firstCaptureDone = vault.firstCaptureDone,
                shadeTileAdded = vault.shadeTileAdded,
                homeWidgetAdded = vault.homeWidgetAdded,
                lastStatus = vault.lastStatus,
                busy = t.busy,
                banner = t.banner?.first,
                bannerIsError = t.banner?.second == true,
                discoveredVaults = t.discovered,
                listedVaults = t.listed,
                hasAccessRoot = vault.accessRootUri != null,
                hasAllFilesAccess = t.allFiles,
                scanning = t.scanning,
            )
        }.stateIn(
            viewModelScope,
            SharingStarted.Eagerly,
            CaptureUiState(
                vaultLinked = store.current().vaultLinked,
                vaultName = store.current().vaultName,
                firstCaptureDone = store.current().firstCaptureDone,
                shadeTileAdded = store.current().shadeTileAdded,
                homeWidgetAdded = store.current().homeWidgetAdded,
                lastStatus = store.current().lastStatus,
                hasAccessRoot = store.current().accessRootUri != null,
                hasAllFilesAccess = FileTreeAccess.granted(),
            ),
        )

    init {
        restoreFromSystemGrants()
        refreshAllFilesAndScan()
        store.current().accessRootUri?.let { root ->
            viewModelScope.launch { scanSafRoot(root, autoSelectSingle = !store.current().vaultLinked) }
        }
    }

    fun onResume() {
        refreshAllFilesAndScan()
    }

    fun onDraftChange(value: String) {
        draft.value = value
    }

    fun clearBanner() {
        banner.value = null
    }

    fun markShadeTileAdded() {
        store.markShadeTileAdded()
    }

    fun markHomeWidgetAdded() {
        store.markHomeWidgetAdded()
    }

    fun onPickerCancelled() {
        banner.value =
            if (FileTreeAccess.SUPPORTED) {
                "Folder picker closed without a choice. Prefer Allow file access, " +
                    "which finds Remote Vault automatically."
            } else {
                "Folder picker closed without a choice. Pick the folder your vault lives in."
            } to true
    }

    fun refreshAllFilesAndScan() {
        val granted = FileTreeAccess.granted()
        allFiles.value = granted
        if (granted) {
            viewModelScope.launch { runFileScan(autoSelectSingle = !store.current().vaultLinked) }
        }
    }

    fun selectDiscoveredVault(vault: DiscoveredVault) {
        store.setFileVault(vault.absolutePath, vault.name)
        viewModelScope.launch {
            withContext(Dispatchers.IO) { CaptureHomeWidget.updateAll(getApplication()) }
        }
        banner.value =
            "Using ${vault.name}. Long-press home → Widgets → Atoms Capture for one-tap capture." to false
    }

    fun onAccessRootPicked(uri: Uri) {
        viewModelScope.launch {
            val cr = getApplication<Application>().contentResolver
            val flags =
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            try {
                cr.takePersistableUriPermission(uri, flags)
            } catch (e: SecurityException) {
                banner.value =
                    "Could not keep folder access (${e.message}). Try again." to true
                return@launch
            }
            store.setAccessRoot(uri)
            scanSafRoot(uri, autoSelectSingle = true)
        }
    }

    fun selectVault(ref: VaultRef) {
        val root = store.current().accessRootUri
        if (root == null) {
            banner.value = "Grant a folder first." to true
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
        if (allFiles.value) {
            viewModelScope.launch { runFileScan(autoSelectSingle = false) }
            return
        }
        val root = store.current().accessRootUri ?: return
        viewModelScope.launch { scanSafRoot(root, autoSelectSingle = false) }
    }

    fun unlinkVault() {
        store.clearVaultLink()
        listed.value = emptyList()
        banner.value = "Vault unlinked." to false
        if (allFiles.value) {
            viewModelScope.launch { runFileScan(autoSelectSingle = false) }
        }
    }

    fun capture() {
        if (!repo.isLinked()) {
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
                    repo.append(text)
                }
            when (result) {
                is InboxWriter.WriteResult.Ok -> {
                    draft.value = ""
                    repo.markCaptureDone("Saved · ${result.stamp} · ${result.preview}")
                    withContext(Dispatchers.IO) {
                        CaptureHomeWidget.updateAll(getApplication())
                    }
                    banner.value =
                        "Saved. Next: add the shade button + home widget for one-second capture." to false
                }
                is InboxWriter.WriteResult.Err -> {
                    repo.setLastStatus("Failed · ${result.message}")
                    banner.value = result.message to true
                }
            }
            busy.value = false
        }
    }

    private suspend fun runFileScan(autoSelectSingle: Boolean) {
        scanning.value = true
        val found =
            withContext(Dispatchers.IO) {
                FileTreeAccess.discover()
            }
        discovered.value = found
        scanning.value = false
        Log.i(TAG, "file scan ${found.size} auto=$autoSelectSingle")

        when {
            found.isEmpty() -> {
                banner.value =
                    "File access is on, but no Obsidian vaults turned up under Documents." to true
            }
            found.size == 1 && autoSelectSingle -> {
                selectDiscoveredVault(found.first())
                banner.value =
                    "Found ${found.first().name}. Captures go to Atoms System/Inbox.md." to false
            }
            store.current().vaultLinked -> Unit
            else -> {
                banner.value =
                    "Found ${found.size} vaults — pick which one to capture into." to false
            }
        }
    }

    private suspend fun scanSafRoot(
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

        when {
            vaults.isEmpty() -> {
                banner.value =
                    if (FileTreeAccess.SUPPORTED) {
                        "No vaults in that folder. Prefer Allow file access."
                    } else {
                        "No vaults in that folder. Try the folder one level up."
                    } to true
            }
            vaults.size == 1 && autoSelectSingle -> {
                val v = vaults.first()
                store.setAccessRootAndVault(uri, v.relativePath, v.name)
                banner.value =
                    "Linked ${v.name}. Captures go to Atoms System/Inbox.md." to false
            }
            store.current().vaultLinked -> Unit
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
            } catch (_: Exception) {
                emptyList()
            }
        if (grants.isNotEmpty()) store.restoreRootIfMissing(grants)
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
