package app.tryatoms.capture.data

import android.content.Context
import app.tryatoms.capture.R

/**
 * Single write/link façade for hub + quick capture + widget.
 */
class CaptureRepository(
    context: Context,
) {
    private val appContext = context.applicationContext
    private val store = VaultStore(appContext)
    private val writer = InboxWriter(appContext)

    fun store(): VaultStore = store

    fun isLinked(): Boolean = store.current().vaultLinked

    fun vaultLabel(): String? = store.current().vaultName

    fun append(body: String): InboxWriter.WriteResult {
        val vault = store.current()
        if (!vault.vaultLinked) {
            return InboxWriter.WriteResult.Err(appContext.getString(R.string.err_not_linked))
        }
        val abs = vault.vaultAbsolutePath
        return if (!abs.isNullOrBlank()) {
            writer.appendCaptureToVaultPath(abs, body)
        } else {
            val root = vault.accessRootUri
            val rel = vault.vaultRelativePath
            if (root == null || rel == null) {
                InboxWriter.WriteResult.Err(appContext.getString(R.string.err_not_linked))
            } else {
                writer.appendCapture(root, rel, body)
            }
        }
    }

    fun markCaptureDone(status: String) {
        store.markCaptureDone(status)
    }

    fun setLastStatus(status: String) {
        store.setLastStatus(status)
    }
}
