package app.tryatoms.capture.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.outlined.FolderOpen
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.tryatoms.capture.R
import app.tryatoms.capture.domain.VaultRef
import app.tryatoms.capture.ui.theme.AtomsShapes
import app.tryatoms.capture.ui.theme.AtomsThemeAccess
import app.tryatoms.capture.ui.theme.atomsFieldColors
import app.tryatoms.capture.ui.theme.atomsFlatCardColors
import app.tryatoms.capture.ui.theme.atomsPrimaryButtonColors
import app.tryatoms.capture.ui.theme.atomsQuietButtonColors
import app.tryatoms.capture.ui.theme.atomsSecondaryButtonColors
import app.tryatoms.capture.ui.theme.claimSerifStyle
import app.tryatoms.capture.ui.theme.kickerStyle

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CaptureScreen(
    state: CaptureUiState,
    onDraftChange: (String) -> Unit,
    onCapture: () -> Unit,
    onFindVaultsSaf: () -> Unit,
    onSelectVault: (VaultRef) -> Unit,
    onUseFolderAsVault: () -> Unit,
    onRescan: () -> Unit,
    onUnlinkVault: () -> Unit,
    onAddShadeTile: () -> Unit,
    onAddHomeWidget: () -> Unit,
    onDismissBanner: () -> Unit,
) {
    val extras = AtomsThemeAccess.extras

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            stringResource(R.string.hub_kicker),
                            style = kickerStyle,
                        )
                        Text(
                            stringResource(R.string.hub_title),
                            style = MaterialTheme.typography.titleLarge,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                    }
                },
                colors =
                    TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.colorScheme.background,
                        titleContentColor = MaterialTheme.colorScheme.onSurface,
                    ),
            )
        },
    ) { padding ->
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(horizontal = 16.dp)
                    .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            // Claim-voice prompt
            Text(
                stringResource(R.string.hub_claim),
                style = claimSerifStyle,
                modifier = Modifier.padding(top = 4.dp, bottom = 2.dp),
            )
            Text(
                stringResource(R.string.hub_subhead),
                style = MaterialTheme.typography.bodySmall,
                color = extras.secondaryText,
            )

            SetupChecklist(
                vaultLinked = state.vaultLinked,
                firstCaptureDone = state.firstCaptureDone,
                shadeTileAdded = state.shadeTileAdded,
                homeWidgetAdded = state.homeWidgetAdded,
                vaultName = state.vaultName,
            )

            if (state.vaultLinked) {
                CaptureFasterCard(
                    shadeDone = state.shadeTileAdded,
                    widgetDone = state.homeWidgetAdded,
                    onAddShadeTile = onAddShadeTile,
                    onAddHomeWidget = onAddHomeWidget,
                )
            }

            if (state.banner != null) {
                StatusBanner(
                    message = state.banner,
                    isError = state.bannerIsError,
                    onDismiss = onDismissBanner,
                )
            }

            VaultChooserCard(
                state = state,
                onFindVaultsSaf = onFindVaultsSaf,
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
                        .heightIn(min = 148.dp),
                placeholder = {
                    Text(
                        stringResource(R.string.hub_placeholder),
                        style = MaterialTheme.typography.bodyLarge,
                        color = extras.tertiaryText,
                    )
                },
                enabled = !state.busy,
                shape = AtomsShapes.field,
                colors = atomsFieldColors(),
                textStyle = MaterialTheme.typography.bodyLarge,
            )

            Button(
                onClick = onCapture,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp),
                enabled = !state.busy && state.draft.isNotBlank() && state.vaultLinked,
                shape = AtomsShapes.button,
                colors = atomsPrimaryButtonColors(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            ) {
                Text(
                    if (state.busy) {
                        stringResource(R.string.hub_saving)
                    } else {
                        stringResource(R.string.hub_capture)
                    },
                    style = MaterialTheme.typography.labelLarge,
                )
            }

            if (state.lastStatus != null) {
                Text(
                    state.lastStatus,
                    style = MaterialTheme.typography.bodySmall,
                    color = extras.tertiaryText,
                )
            }

            Text(
                stringResource(R.string.hub_sync_note),
                style = MaterialTheme.typography.bodySmall,
                color = extras.tertiaryText,
            )

            Spacer(modifier = Modifier.height(28.dp))
        }
    }
}

@Composable
private fun VaultChooserCard(
    state: CaptureUiState,
    onFindVaultsSaf: () -> Unit,
    onSelectVault: (VaultRef) -> Unit,
    onUseFolderAsVault: () -> Unit,
    onRescan: () -> Unit,
    onUnlink: () -> Unit,
) {
    val extras = AtomsThemeAccess.extras

    FlatCard {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                stringResource(R.string.vault_kicker),
                style = kickerStyle,
            )
            Text(
                when {
                    state.vaultLinked -> state.vaultName ?: stringResource(R.string.vault_linked_fallback)
                    state.scanning -> stringResource(R.string.vault_looking)
                    state.listedVaults.isNotEmpty() -> stringResource(R.string.vault_your_vaults)
                    else -> stringResource(R.string.vault_choose)
                },
                style = MaterialTheme.typography.titleMedium,
            )

            if (state.vaultLinked) {
                Text(
                    stringResource(R.string.vault_inbox_path),
                    style = MaterialTheme.typography.bodySmall,
                    color = extras.secondaryText,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = onRescan, colors = atomsQuietButtonColors()) {
                        Text(stringResource(R.string.vault_switch))
                    }
                    TextButton(onClick = onUnlink, colors = atomsQuietButtonColors()) {
                        Text(stringResource(R.string.vault_unlink))
                    }
                }
                return@FlatCard
            }

            if (state.listedVaults.isEmpty()) {
                Text(
                    stringResource(R.string.vault_pick_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = extras.secondaryText,
                )
                FolderPickerButton(primary = true, onClick = onFindVaultsSaf)
            } else {
                VaultRefList(state.listedVaults, onSelectVault)
                FolderPickerButton(primary = false, onClick = onFindVaultsSaf)
            }
            if (state.hasAccessRoot) {
                TextButton(onClick = onUseFolderAsVault, colors = atomsQuietButtonColors()) {
                    Text(stringResource(R.string.vault_use_this_folder))
                }
            }
        }
    }
}

/** One folder-picker button. Primary on first link, outlined when switching. */
@Composable
private fun FolderPickerButton(
    primary: Boolean,
    onClick: () -> Unit,
) {
    val modifier =
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
    if (primary) {
        Button(
            onClick = onClick,
            modifier = modifier,
            shape = AtomsShapes.button,
            colors = atomsPrimaryButtonColors(),
        ) {
            FolderPickerLabel()
        }
    } else {
        OutlinedButton(
            onClick = onClick,
            modifier = modifier,
            shape = AtomsShapes.button,
            border = BorderStroke(1.dp, AtomsThemeAccess.extras.hairline),
            colors =
                androidx.compose.material3.ButtonDefaults.outlinedButtonColors(
                    contentColor = MaterialTheme.colorScheme.onSurface,
                ),
        ) {
            FolderPickerLabel()
        }
    }
}

/** The list of vaults found inside a granted folder. Same rows on every surface. */
@Composable
private fun VaultRefList(
    vaults: List<VaultRef>,
    onSelect: (VaultRef) -> Unit,
) {
    vaults.forEach { vault ->
        VaultPickRow(
            title = vault.name,
            subtitle = stringResource(R.string.vault_kind_obsidian),
            onClick = { onSelect(vault) },
        )
    }
}

/** Shared by the primary and outlined folder-picker buttons so they cannot drift. */
@Composable
private fun FolderPickerLabel() {
    Icon(
        Icons.Outlined.FolderOpen,
        contentDescription = stringResource(R.string.vault_folder_picker),
        modifier = Modifier.size(18.dp),
    )
    Spacer(modifier = Modifier.size(8.dp))
    Text(stringResource(R.string.vault_folder_picker), style = MaterialTheme.typography.labelLarge)
}

@Composable
private fun VaultPickRow(
    title: String,
    subtitle: String,
    onClick: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Button(
            onClick = onClick,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp),
            shape = AtomsShapes.button,
            colors = atomsSecondaryButtonColors(),
        ) {
            Text(title, style = MaterialTheme.typography.labelLarge)
        }
        Text(
            subtitle,
            style = MaterialTheme.typography.bodySmall,
            color = AtomsThemeAccess.extras.tertiaryText,
            modifier = Modifier.padding(start = 4.dp),
        )
    }
}

@Composable
private fun SetupChecklist(
    vaultLinked: Boolean,
    firstCaptureDone: Boolean,
    shadeTileAdded: Boolean,
    homeWidgetAdded: Boolean,
    vaultName: String?,
) {
    FlatCard {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.setup_kicker), style = kickerStyle)
            ChecklistRow(
                done = vaultLinked,
                label = stringResource(R.string.setup_choose_vault),
                detail =
                    if (vaultLinked && vaultName != null) {
                        vaultName
                    } else {
                        stringResource(R.string.setup_choose_vault_detail)
                    },
            )
            ChecklistRow(
                done = firstCaptureDone,
                label = stringResource(R.string.setup_first_capture),
                detail = stringResource(R.string.setup_first_capture_detail),
            )
            ChecklistRow(
                done = shadeTileAdded,
                label = stringResource(R.string.setup_shade),
                detail = stringResource(R.string.setup_shade_detail),
            )
            ChecklistRow(
                done = homeWidgetAdded,
                label = stringResource(R.string.setup_widget),
                detail = stringResource(R.string.setup_widget_detail),
            )
        }
    }
}

/**
 * Teaches the two optimal capture surfaces once the vault is linked.
 * Opening this hub is for setup — day-to-day capture is shade + widget.
 */
@Composable
private fun CaptureFasterCard(
    shadeDone: Boolean,
    widgetDone: Boolean,
    onAddShadeTile: () -> Unit,
    onAddHomeWidget: () -> Unit,
) {
    val extras = AtomsThemeAccess.extras
    FlatCard {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.faster_kicker), style = kickerStyle)
            Text(
                stringResource(R.string.faster_intro),
                style = MaterialTheme.typography.bodyMedium,
                color = extras.secondaryText,
            )

            Text(
                stringResource(R.string.faster_shade_title),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                stringResource(R.string.faster_shade_body),
                style = MaterialTheme.typography.bodySmall,
                color = extras.secondaryText,
            )
            if (shadeDone) {
                Text(
                    stringResource(R.string.faster_shade_added),
                    style = MaterialTheme.typography.bodySmall,
                    color = extras.done,
                )
            } else {
                Button(
                    onClick = onAddShadeTile,
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp),
                    shape = AtomsShapes.button,
                    colors = atomsPrimaryButtonColors(),
                ) {
                    Text(stringResource(R.string.faster_shade_add), style = MaterialTheme.typography.labelLarge)
                }
                Text(
                    stringResource(R.string.faster_shade_or),
                    style = MaterialTheme.typography.bodySmall,
                    color = extras.tertiaryText,
                )
            }

            Spacer(modifier = Modifier.height(4.dp))

            Text(
                stringResource(R.string.faster_widget_title),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                stringResource(R.string.faster_widget_body),
                style = MaterialTheme.typography.bodySmall,
                color = extras.secondaryText,
            )
            if (widgetDone) {
                Text(
                    stringResource(R.string.faster_widget_added),
                    style = MaterialTheme.typography.bodySmall,
                    color = extras.done,
                )
            } else {
                OutlinedButton(
                    onClick = onAddHomeWidget,
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp),
                    shape = AtomsShapes.button,
                    border = BorderStroke(1.dp, extras.hairline),
                ) {
                    Text(stringResource(R.string.faster_widget_add), style = MaterialTheme.typography.labelLarge)
                }
            }

            Text(
                stringResource(R.string.faster_shortcut),
                style = MaterialTheme.typography.bodySmall,
                color = extras.tertiaryText,
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
    val extras = AtomsThemeAccess.extras
    Row(
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            imageVector = if (done) Icons.Filled.CheckCircle else Icons.Outlined.Circle,
            contentDescription =
                if (done) {
                    stringResource(R.string.setup_done_cd)
                } else {
                    stringResource(R.string.setup_not_done_cd)
                },
            tint = if (done) extras.done else extras.tertiaryText,
            modifier =
                Modifier
                    .padding(top = 2.dp)
                    .size(22.dp),
        )
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                label,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = if (done) FontWeight.SemiBold else FontWeight.Medium,
            )
            Text(
                detail,
                style = MaterialTheme.typography.bodySmall,
                color = extras.secondaryText,
            )
        }
    }
}

@Composable
private fun StatusBanner(
    message: String,
    isError: Boolean,
    onDismiss: () -> Unit,
) {
    val extras = AtomsThemeAccess.extras
    val fill = if (isError) extras.errorFill else extras.statusFill
    val border = if (isError) extras.errorBorder else extras.statusBorder
    val fg =
        if (isError) {
            MaterialTheme.colorScheme.error
        } else {
            MaterialTheme.colorScheme.onSurface
        }

    Card(
        shape = AtomsShapes.card,
        colors = CardDefaults.cardColors(containerColor = fill),
        border = BorderStroke(1.dp, border),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(start = 16.dp, end = 4.dp, top = 10.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                message,
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodyMedium,
                color = fg,
            )
            TextButton(onClick = onDismiss, colors = atomsQuietButtonColors()) {
                Text(stringResource(R.string.dismiss_ok))
            }
        }
    }
}

@Composable
private fun FlatCard(content: @Composable () -> Unit) {
    val extras = AtomsThemeAccess.extras
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = AtomsShapes.card,
        colors = atomsFlatCardColors(),
        border = BorderStroke(1.dp, extras.hairline),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            content()
        }
    }
}
