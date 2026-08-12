package app.tryatoms.capture

import android.Manifest
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContract
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import app.tryatoms.capture.R
import app.tryatoms.capture.tile.CaptureTileService
import app.tryatoms.capture.ui.CaptureScreen
import app.tryatoms.capture.ui.CaptureViewModel
import app.tryatoms.capture.ui.theme.AtomsTheme
import app.tryatoms.capture.widget.CaptureHomeWidget
import app.tryatoms.capture.widget.CaptureHomeWidgetReceiver
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

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
                Toast.makeText(this, getString(R.string.toast_scanning), Toast.LENGTH_SHORT).show()
                viewModel.onAccessRootPicked(uri)
            } else {
                viewModel.onPickerCancelled()
            }
        }

    private val requestRuntime =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        WindowCompat.setDecorFitsSystemWindows(window, false)
        ensureRuntimePermissions()
        setContent {
            val dark = isSystemInDarkTheme()
            AtomsTheme(darkTheme = dark) {
                SideEffect {
                    @Suppress("DEPRECATION")
                    run {
                        window.statusBarColor = android.graphics.Color.TRANSPARENT
                        window.navigationBarColor =
                            if (dark) {
                                android.graphics.Color.BLACK
                            } else {
                                android.graphics.Color.parseColor("#F2F2F7")
                            }
                    }
                    WindowCompat.getInsetsController(window, window.decorView).apply {
                        isAppearanceLightStatusBars = !dark
                        isAppearanceLightNavigationBars = !dark
                    }
                }
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = androidx.compose.material3.MaterialTheme.colorScheme.background,
                ) {
                    val state by viewModel.uiState.collectAsStateWithLifecycle()
                    CaptureScreen(
                        state = state,
                        onDraftChange = viewModel::onDraftChange,
                        onCapture = viewModel::capture,
                        onFindVaultsSaf = {
                            Toast
                                .makeText(
                                    this,
                                    getString(R.string.toast_pick_folder),
                                    Toast.LENGTH_LONG,
                                ).show()
                            openTree.launch(null)
                        },
                        onSelectVault = viewModel::selectVault,
                        onUseFolderAsVault = viewModel::useAccessRootAsVault,
                        onRescan = viewModel::rescanListedVaults,
                        onUnlinkVault = viewModel::unlinkVault,
                        onAddShadeTile = ::offerShadeTile,
                        onAddHomeWidget = ::offerHomeWidget,
                        onDismissBanner = viewModel::clearBanner,
                    )
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        viewModel.onResume()
        // Refresh home widget layout after installs (OEMs cache old Glance trees)
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                CaptureHomeWidget.updateAll(applicationContext)
            } catch (_: Exception) {
            }
        }
    }

    private fun ensureRuntimePermissions() {
        val needed = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            needed += Manifest.permission.RECORD_AUDIO
        }
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            needed += Manifest.permission.POST_NOTIFICATIONS
        }
        if (needed.isNotEmpty()) {
            requestRuntime.launch(needed.toTypedArray())
        }
    }

    private fun offerShadeTile() {
        val ok = CaptureTileService.requestAdd(this)
        // Optimistic mark — system may dismiss without callback on some OEMs.
        viewModel.markShadeTileAdded()
        Toast
            .makeText(
                this,
                if (ok) {
                    getString(R.string.toast_tile_confirm)
                } else {
                    getString(R.string.toast_tile_manual)
                },
                Toast.LENGTH_LONG,
            ).show()
    }

    private fun offerHomeWidget() {
        val manager = AppWidgetManager.getInstance(this)
        val provider = ComponentName(this, CaptureHomeWidgetReceiver::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.isRequestPinAppWidgetSupported) {
            val pinned =
                manager.requestPinAppWidget(provider, null, null)
            if (pinned) {
                viewModel.markHomeWidgetAdded()
                Toast
                    .makeText(this, getString(R.string.toast_widget_confirm), Toast.LENGTH_LONG)
                    .show()
                return
            }
        }
        viewModel.markHomeWidgetAdded()
        Toast
            .makeText(
                this,
                getString(R.string.toast_widget_manual),
                Toast.LENGTH_LONG,
            ).show()
    }

    companion object {
        private const val TAG = "AtomsCapture"
    }
}
