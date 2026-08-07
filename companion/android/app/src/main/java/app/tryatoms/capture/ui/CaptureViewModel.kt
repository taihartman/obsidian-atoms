package app.tryatoms.capture.ui

import android.app.Application
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.tryatoms.capture.data.InboxWriter
import app.tryatoms.capture.data.SafVaultScanner
import app.tryatoms.capture.data.VaultStore
import app.tryatoms.capture.domain.VaultPaths
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
    /** Vaults under the last granted access root (in-app picker). */
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
    private var accessRootUri: Uri? = null
    private var vaultRelativePath: String? = null

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
            accessRootUri = vault.accessRootUri
            vaultRelativePath = vault.vaultRelativePath
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
            SharingStarted.WhileSubscribed(5_000),
            CaptureUiState(),
        )

    fun pickerInitialUri(): Uri = VaultPaths.documentsTreeUri()

    fun onDraftChange(value: String) {
        draft.value = value
    }

    fun clearBanner() {
        banner.value = null
    }

    /**
     * User granted a folder via SAF (Documents, whole storage, or a single vault).
     * Scan it and list every vault inside for in-app choice.
     */
    fun onAccessRootPicked(uri: Uri) {
        viewModelScope.launch {
            val cr = getApplication<Application>().contentResolver
            val flags =
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            try {
                cr.takePersistableUriPermission(uri, flags)
            } catch (e: SecurityException) {
                banner.value = (e.message ?: "Could not keep folder permission") to true
                return@launch
            }

            scanning.value = true
            store.setAccessRoot(uri)
            val vaults =
                withContext(Dispatchers.IO) {
                    safScanner.listVaults(uri)
                }
            listed.value = vaults
            scanning.value = false

            when {
                vaults.isEmpty() -> {
                    banner.value =
                        "No vaults found there. In the picker, open Documents and tap " +
                        "“Use this folder” on Documents itself (not a file). " +
                        "Or open your vault folder and use “Use this folder as vault”." to true
                }
                vaults.size == 1 -> {
                    selectVault(vaults.first())
                    banner.value =
                        "Linked ${vaults.first().name}. Captures go to Atoms System/Inbox.md." to false
                }
                else -> {
                    banner.value =
                        "Found ${vaults.size} vaults — pick which one to capture into." to false
                }
            }
        }
    }

    fun selectVault(ref: VaultRef) {
        viewModelScope.launch {
            store.setSelectedVault(ref.relativePath, ref.name)
            banner.value =
                "Using ${ref.name}. Captures go to Atoms System/Inbox.md." to false
        }
    }

    /** When scan finds nothing but user insists this folder is the vault. */
    fun useAccessRootAsVault() {
        viewModelScope.launch {
            val root = accessRootUri ?: return@launch
            val name = guessName(root) ?: "Vault"
            store.setVaultAsRoot(root, name)
            listed.value =
                listOf(VaultRef(name = name, relativePath = "", score = 1))
            banner.value = "Using $name as your vault." to false
        }
    }

    fun rescanListedVaults() {
        val root = accessRootUri ?: return
        viewModelScope.launch {
            scanning.value = true
            val vaults =
                withContext(Dispatchers.IO) {
                    safScanner.listVaults(root)
                }
            listed.value = vaults
            scanning.value = false
            banner.value =
                if (vaults.isEmpty()) {
                    "Still no vaults here. Try granting Documents or your storage root." to true
                } else {
                    "Found ${vaults.size} vault${if (vaults.size == 1) "" else "s"}." to false
                }
        }
    }

    fun unlinkVault() {
        viewModelScope.launch {
            store.clearVaultLink()
            listed.value = emptyList()
            banner.value = "Vault unlinked." to false
        }
    }

    fun capture() {
        val state = uiState.value
        val root = accessRootUri
        val rel = vaultRelativePath
        if (root == null || rel == null) {
            banner.value = "Choose a vault first." to true
            return
        }
        if (state.draft.isBlank()) {
            banner.value = "Type something first." to true
            return
        }
        if (state.busy) return

        viewModelScope.launch {
            busy.value = true
            banner.value = null
            val text = state.draft
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

    private fun guessName(treeUri: Uri): String? {
        return try {
            val docId =
                if (DocumentsContract.isTreeUri(treeUri)) {
                    DocumentsContract.getTreeDocumentId(treeUri)
                } else {
                    DocumentsContract.getDocumentId(treeUri)
                }
            docId.substringAfterLast(':').substringAfterLast('/')
        } catch (_: Exception) {
            null
        }
    }
}
