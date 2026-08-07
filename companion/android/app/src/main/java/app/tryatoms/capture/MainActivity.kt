package app.tryatoms.capture

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
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

class OpenPersistableTree : ActivityResultContract<Uri?, Uri?>() {
    override fun createIntent(
        context: Context,
        input: Uri?,
    ): Intent {
        return Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PREFIX_URI_PERMISSION,
            )
        }
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
                        onAllowFileAccess = ::openAllFilesSettings,
                        onFindVaultsSaf = {
                            Toast
                                .makeText(
                                    this,
                                    "Select a folder, then tap Use this folder",
                                    Toast.LENGTH_LONG,
                                ).show()
                            openTree.launch(null)
                        },
                        onSelectDiscovered = viewModel::selectDiscoveredVault,
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

    override fun onResume() {
        super.onResume()
        viewModel.onResume()
    }

    private fun openAllFilesSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                val intent =
                    Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).apply {
                        data = Uri.parse("package:$packageName")
                    }
                startActivity(intent)
                Toast
                    .makeText(
                        this,
                        "Turn on Allow access to manage all files, then return here",
                        Toast.LENGTH_LONG,
                    ).show()
            } catch (e: Exception) {
                Log.e(TAG, "all-files settings failed", e)
                startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
            }
        } else {
            viewModel.refreshAllFilesAndScan()
        }
    }

    companion object {
        private const val TAG = "AtomsCapture"
    }
}
