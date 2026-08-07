package app.tryatoms.capture.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.tryatoms.capture.domain.VaultRef

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CaptureScreen(
    state: CaptureUiState,
    onDraftChange: (String) -> Unit,
    onCapture: () -> Unit,
    onFindVaults: () -> Unit,
    onSelectVault: (VaultRef) -> Unit,
    onUseFolderAsVault: () -> Unit,
    onRescan: () -> Unit,
    onUnlinkVault: () -> Unit,
    onDismissBanner: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            "Atoms Capture",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            "Quick capture for your vault",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                colors =
                    TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.colorScheme.surface,
                    ),
            )
        },
    ) { padding ->
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(horizontal = 20.dp)
                    .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            SetupChecklist(
                vaultLinked = state.vaultLinked,
                firstCaptureDone = state.firstCaptureDone,
                vaultName = state.vaultName,
            )

            if (state.banner != null) {
                BannerCard(
                    message = state.banner,
                    isError = state.bannerIsError,
                    onDismiss = onDismissBanner,
                )
            }

            VaultChooserCard(
                state = state,
                onFindVaults = onFindVaults,
                onSelectVault = onSelectVault,
                onUseFolderAsVault = onUseFolderAsVault,
                onRescan = onRescan,
                onUnlink = onUnlinkVault,
            )

            OutlinedTextField(
                value = state.draft,
                onValueChange = onDraftChange,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .height(160.dp),
                placeholder = { Text("What's on your mind?") },
                enabled = !state.busy,
            )

            Button(
                onClick = onCapture,
                modifier = Modifier.fillMaxWidth(),
                enabled = !state.busy && state.draft.isNotBlank() && state.vaultLinked,
            ) {
                Text(if (state.busy) "Saving…" else "Capture")
            }

            Text(
                "With Obsidian closed, the line is on this device immediately. " +
                    "It reaches your other devices after you open Obsidian (Sync).",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}

@Composable
private fun VaultChooserCard(
    state: CaptureUiState,
    onFindVaults: () -> Unit,
    onSelectVault: (VaultRef) -> Unit,
    onUseFolderAsVault: () -> Unit,
    onRescan: () -> Unit,
    onUnlink: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors =
            CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.55f),
            ),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                when {
                    state.vaultLinked -> "Vault"
                    state.scanning -> "Looking for vaults…"
                    state.listedVaults.isNotEmpty() -> "Your vaults"
                    state.hasAccessRoot -> "No vaults in that folder"
                    else -> "Choose a vault"
                },
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )

            if (state.vaultLinked) {
                Text(
                    state.vaultName ?: "Linked",
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = onFindVaults) {
                        Text("Switch vault")
                    }
                    TextButton(onClick = onUnlink) {
                        Text("Unlink")
                    }
                }
                return@Column
            }

            if (!state.hasAccessRoot) {
                Text(
                    "Allow access to Documents (or the folder that holds your vaults). " +
                        "We’ll list every Obsidian vault we find — you pick one.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                )
                Button(onClick = onFindVaults, modifier = Modifier.fillMaxWidth()) {
                    Icon(
                        Icons.Outlined.FolderOpen,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(modifier = Modifier.size(8.dp))
                    Text("Find my vaults")
                }
                return@Column
            }

            // Have access root
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    if (state.scanning) {
                        "Scanning…"
                    } else {
                        "${state.listedVaults.size} found"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                )
                TextButton(onClick = onRescan, enabled = !state.scanning) {
                    Icon(
                        Icons.Outlined.Refresh,
                        contentDescription = "Scan again",
                        modifier = Modifier.size(18.dp),
                    )
                }
            }

            if (state.listedVaults.isEmpty() && !state.scanning) {
                Text(
                    "Tip: in the system picker, choose Documents or the parent folder — " +
                        "not a single note file.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                )
                Button(onClick = onUseFolderAsVault, modifier = Modifier.fillMaxWidth()) {
                    Text("Use this folder as vault")
                }
                OutlinedButton(onClick = onFindVaults, modifier = Modifier.fillMaxWidth()) {
                    Text("Pick a different folder")
                }
            } else {
                state.listedVaults.forEach { vault ->
                    val subtitle =
                        buildString {
                            if (vault.relativePath.isNotEmpty() && vault.relativePath != vault.name) {
                                append(vault.relativePath)
                                append(" · ")
                            }
                            append(if (vault.score >= 11) "Atoms ready" else "Obsidian vault")
                        }
                    Button(
                        onClick = { onSelectVault(vault) },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(vault.name)
                    }
                    Text(
                        subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                    )
                }
                TextButton(onClick = onFindVaults) {
                    Text("Scan a different folder")
                }
            }
        }
    }
}

@Composable
private fun SetupChecklist(
    vaultLinked: Boolean,
    firstCaptureDone: Boolean,
    vaultName: String?,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors =
            CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
            ),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                "Get Atoms going",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            ChecklistRow(
                done = vaultLinked,
                label = "Choose your vault",
                detail =
                    if (vaultLinked && vaultName != null) {
                        vaultName
                    } else {
                        "We’ll list the ones on this phone"
                    },
            )
            ChecklistRow(
                done = firstCaptureDone,
                label = "Save a capture",
                detail = "It lands in Atoms System/Inbox.md",
            )
            Text(
                "Then open Obsidian — Atoms files captures into your daily notes.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ChecklistRow(
    done: Boolean,
    label: String,
    detail: String,
) {
    Row(
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            imageVector = if (done) Icons.Filled.CheckCircle else Icons.Outlined.Circle,
            contentDescription = if (done) "Done" else "Not done",
            tint =
                if (done) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
            modifier = Modifier.size(22.dp),
        )
        Column {
            Text(
                label,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = if (done) FontWeight.Medium else FontWeight.Normal,
            )
            Text(
                detail,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun BannerCard(
    message: String,
    isError: Boolean,
    onDismiss: () -> Unit,
) {
    Card(
        colors =
            CardDefaults.cardColors(
                containerColor =
                    if (isError) {
                        MaterialTheme.colorScheme.errorContainer
                    } else {
                        MaterialTheme.colorScheme.primaryContainer
                    },
            ),
    ) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                message,
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodyMedium,
                color =
                    if (isError) {
                        MaterialTheme.colorScheme.onErrorContainer
                    } else {
                        MaterialTheme.colorScheme.onPrimaryContainer
                    },
            )
            TextButton(onClick = onDismiss) {
                Text("OK")
            }
        }
    }
}
