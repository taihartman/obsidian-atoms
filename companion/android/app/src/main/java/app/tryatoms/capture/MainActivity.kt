package app.tryatoms.capture

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
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

class MainActivity : ComponentActivity() {
    private val viewModel: CaptureViewModel by viewModels()

    private val openTree =
        registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
            if (uri != null) {
                viewModel.onVaultPicked(uri)
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
                        onUseDiscoveredVault = { vault ->
                            openTree.launch(vault.treeUri ?: viewModel.pickerInitialUri(vault))
                        },
                        onPickVault = {
                            openTree.launch(viewModel.pickerInitialUri())
                        },
                        onRescan = viewModel::refreshDiscoveredVaults,
                        onUnlinkVault = viewModel::unlinkVault,
                        onDismissBanner = viewModel::clearBanner,
                    )
                }
            }
        }
    }
}
