package app.tryatoms.capture

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.DocumentsContract
import android.util.Log
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContract
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.tryatoms.capture.ui.CaptureScreen
import app.tryatoms.capture.ui.CaptureViewModel

/**
 * OPEN_DOCUMENT_TREE with persistable read/write flags.
 * Stock [ActivityResultContracts.OpenDocumentTree] omits persistable flags on
 * some API levels, which makes takePersistableUriPermission fail silently later.
 */
class OpenPersistableTree : ActivityResultContract<Uri?, Uri?>() {
    override fun createIntent(
        context: Context,
        input: Uri?,
    ): Intent {
        val intent =
            Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or
                        Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                        Intent.FLAG_GRANT_PREFIX_URI_PERMISSION,
                )
                // Document URI (not tree) — tree URIs the app doesn't own can break the picker
                if (input != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    putExtra(DocumentsContract.EXTRA_INITIAL_URI, input)
                }
            }
        return intent
    }

    override fun parseResult(
        resultCode: Int,
        intent: Intent?,
    ): Uri? {
        if (resultCode != android.app.Activity.RESULT_OK) return null
        return intent?.data
    }
}

class MainActivity : ComponentActivity() {
    private val viewModel: CaptureViewModel by viewModels()

    private val openTree =
        registerForActivityResult(OpenPersistableTree()) { uri ->
            Log.i(TAG, "picker result uri=$uri")
            if (uri != null) {
                Toast.makeText(this, "Scanning for vaults…", Toast.LENGTH_SHORT).show()
                viewModel.onAccessRootPicked(uri)
            } else {
                viewModel.onPickerCancelled()
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val dark = isSystemInDarkTheme()
            MaterialTheme(
                colorScheme = if (dark) darkColorScheme() else lightColorScheme(),
            ) {
                Surface(modifier = Modifier.fillMaxSize()) {
                    val state by viewModel.uiState.collectAsStateWithLifecycle()
                    CaptureScreen(
                        state = state,
                        onDraftChange = viewModel::onDraftChange,
                        onCapture = viewModel::capture,
                        onFindVaults = {
                            Toast
                                .makeText(
                                    this,
                                    "Select a folder, then tap Use this folder",
                                    Toast.LENGTH_LONG,
                                ).show()
                            // null = reliable default start; Documents initial is optional
                            openTree.launch(null)
                        },
                        onSelectVault = viewModel::selectVault,
                        onUseFolderAsVault = viewModel::useAccessRootAsVault,
                        onRescan = viewModel::rescanListedVaults,
                        onUnlinkVault = viewModel::unlinkVault,
                        onDismissBanner = viewModel::clearBanner,
                    )
                }
            }
        }
    }

    companion object {
        private const val TAG = "AtomsCapture"
    }
}
