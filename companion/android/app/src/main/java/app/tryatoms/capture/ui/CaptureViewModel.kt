package app.tryatoms.capture.ui

import android.app.Application
import android.content.Intent
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.tryatoms.capture.data.InboxWriter
import app.tryatoms.capture.data.VaultStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class CaptureUiState(
    val draft: String = "",
    val treeUri: Uri? = null,
    val firstCaptureDone: Boolean = false,
    val lastStatus: String? = null,
    val busy: Boolean = false,
    val banner: String? = null,
    val bannerIsError: Boolean = false,
) {
    val vaultLinked: Boolean get() = treeUri != null
}

class CaptureViewModel(
    app: Application,
) : AndroidViewModel(app) {
    private val store = VaultStore(app)
    private val writer = InboxWriter(app)

    private val draft = MutableStateFlow("")
    private val busy = MutableStateFlow(false)
    private val banner = MutableStateFlow<Pair<String, Boolean>?>(null)

    val uiState: StateFlow<CaptureUiState> =
        combine(store.state, draft, busy, banner) { vault, text, isBusy, ban ->
            CaptureUiState(
                draft = text,
                treeUri = vault.treeUri,
                firstCaptureDone = vault.firstCaptureDone,
                lastStatus = vault.lastStatus,
                busy = isBusy,
                banner = ban?.first,
                bannerIsError = ban?.second == true,
            )
        }.stateIn(
            viewModelScope,
            SharingStarted.WhileSubscribed(5_000),
            CaptureUiState(),
        )

    fun onDraftChange(value: String) {
        draft.value = value
    }

    fun clearBanner() {
        banner.value = null
    }

    fun onVaultPicked(uri: Uri) {
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
            store.setTreeUri(uri)
            banner.value = "Vault linked. Captures go to Atoms System/Inbox.md." to false
        }
    }

    fun unlinkVault() {
        viewModelScope.launch {
            store.clearTreeUri()
            banner.value = "Vault unlinked." to false
        }
    }

    fun capture() {
        val state = uiState.value
        val uri = state.treeUri
        if (uri == null) {
            banner.value = "Link your Obsidian vault folder first." to true
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
                    writer.appendCapture(uri, text)
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
}
