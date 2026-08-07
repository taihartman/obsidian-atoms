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
import app.tryatoms.capture.domain.DiscoveredVault
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
    onAllowFileAccess: () -> Unit,
    onFindVaultsSaf: () -> Unit,
    onSelectDiscovered: (DiscoveredVault) -> Unit,
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
                            "CAPTURE",
                            style = kickerStyle,
                        )
                        Text(
                            "Atoms",
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
                "“What’s on your mind?”",
                style = claimSerifStyle,
                modifier = Modifier.padding(top = 4.dp, bottom = 2.dp),
            )
            Text(
                "A thought lands in your vault. Atoms files it later.",
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
                onAllowFileAccess = onAllowFileAccess,
                onFindVaultsSaf = onFindVaultsSaf,
                onSelectDiscovered = onSelectDiscovered,
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
                        "Type freely…",
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
                    if (state.busy) "Saving…" else "Capture",
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
                "With Obsidian closed, the line is on this device immediately. " +
                    "It reaches your other devices after you open Obsidian.",
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
    onAllowFileAccess: () -> Unit,
    onFindVaultsSaf: () -> Unit,
    onSelectDiscovered: (DiscoveredVault) -> Unit,
    onSelectVault: (VaultRef) -> Unit,
    onUseFolderAsVault: () -> Unit,
    onRescan: () -> Unit,
    onUnlink: () -> Unit,
) {
    val extras = AtomsThemeAccess.extras

    FlatCard {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                "VAULT",
                style = kickerStyle,
            )
            Text(
                when {
                    state.vaultLinked -> state.vaultName ?: "Linked"
                    state.scanning -> "Looking for vaults…"
                    state.discoveredVaults.isNotEmpty() ->
                        "Found ${state.discoveredVaults.size} vault${if (state.discoveredVaults.size == 1) "" else "s"}"
                    state.listedVaults.isNotEmpty() -> "Your vaults"
                    else -> "Choose a vault"
                },
                style = MaterialTheme.typography.titleMedium,
            )

            if (state.vaultLinked) {
                Text(
                    "Captures go to Atoms System/Inbox.md",
                    style = MaterialTheme.typography.bodySmall,
                    color = extras.secondaryText,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = onRescan, colors = atomsQuietButtonColors()) {
                        Text("Switch")
                    }
                    TextButton(onClick = onUnlink, colors = atomsQuietButtonColors()) {
                        Text("Unlink")
                    }
                }
                return@FlatCard
            }

            if (!state.hasAllFilesAccess) {
                Text(
                    "Allow file access once and we’ll find Obsidian vaults on this phone automatically.",
                    style = MaterialTheme.typography.bodySmall,
                    color = extras.secondaryText,
                )
                Button(
                    onClick = onAllowFileAccess,
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp),
                    shape = AtomsShapes.button,
                    colors = atomsPrimaryButtonColors(),
                ) {
                    Text("Allow file access", style = MaterialTheme.typography.labelLarge)
                }
                Text(
                    "Or pick a folder manually",
                    style = MaterialTheme.typography.bodySmall,
                    color = extras.tertiaryText,
                )
                OutlinedButton(
                    onClick = onFindVaultsSaf,
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp),
                    shape = AtomsShapes.button,
                    border = BorderStroke(1.dp, extras.hairline),
                    colors =
                        androidx.compose.material3.ButtonDefaults.outlinedButtonColors(
                            contentColor = MaterialTheme.colorScheme.onSurface,
                        ),
                ) {
                    Icon(
                        Icons.Outlined.FolderOpen,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(modifier = Modifier.size(8.dp))
                    Text("Folder picker", style = MaterialTheme.typography.labelLarge)
                }
                return@FlatCard
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    if (state.scanning) "Scanning…" else "On this phone",
                    style = MaterialTheme.typography.bodySmall,
                    color = extras.secondaryText,
                )
                TextButton(
                    onClick = onRescan,
                    enabled = !state.scanning,
                    colors = atomsQuietButtonColors(),
                ) {
                    Icon(
                        Icons.Outlined.Refresh,
                        contentDescription = "Scan again",
                        modifier = Modifier.size(18.dp),
                    )
                }
            }

            if (state.discoveredVaults.isNotEmpty()) {
                state.discoveredVaults.forEach { vault ->
                    VaultPickRow(
                        title = vault.name,
                        subtitle = if (vault.score >= 11) "Atoms ready" else "Obsidian vault",
                        onClick = { onSelectDiscovered(vault) },
                    )
                }
            } else if (state.listedVaults.isNotEmpty()) {
                state.listedVaults.forEach { vault ->
                    VaultPickRow(
                        title = vault.name,
                        subtitle = "Obsidian vault",
                        onClick = { onSelectVault(vault) },
                    )
                }
            } else if (!state.scanning) {
                Text(
                    "No vaults found yet.",
                    style = MaterialTheme.typography.bodySmall,
                    color = extras.secondaryText,
                )
                OutlinedButton(
                    onClick = onFindVaultsSaf,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    shape = AtomsShapes.button,
                    border = BorderStroke(1.dp, extras.hairline),
                ) {
                    Text("Folder picker")
                }
                if (state.hasAccessRoot) {
                    TextButton(onClick = onUseFolderAsVault, colors = atomsQuietButtonColors()) {
                        Text("Use this folder as vault")
                    }
                }
            }
        }
    }
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
            Text("GET ATOMS GOING", style = kickerStyle)
            ChecklistRow(
                done = vaultLinked,
                label = "Choose your vault",
                detail =
                    if (vaultLinked && vaultName != null) {
                        vaultName
                    } else {
                        "We’ll find vaults on this phone"
                    },
            )
            ChecklistRow(
                done = firstCaptureDone,
                label = "Save a first capture",
                detail = "Try the box below once — then switch to one-tap",
            )
            ChecklistRow(
                done = shadeTileAdded,
                label = "Add the shade button",
                detail = "Pull down the shade → Capture. Fastest from any screen.",
            )
            ChecklistRow(
                done = homeWidgetAdded,
                label = "Add the home widget",
                detail = "One tap on the home screen opens the strip",
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
            Text("CAPTURE IN ONE SECOND", style = kickerStyle)
            Text(
                "This hub is for setup. Day to day, don’t open the app — use these:",
                style = MaterialTheme.typography.bodyMedium,
                color = extras.secondaryText,
            )

            Text(
                "1. Shade button",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                "Pull down from the top of the screen → tap Capture. " +
                    "Works over any app. Add it once:",
                style = MaterialTheme.typography.bodySmall,
                color = extras.secondaryText,
            )
            if (shadeDone) {
                Text(
                    "Added · pull the shade anytime",
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
                    Text("Add shade button", style = MaterialTheme.typography.labelLarge)
                }
                Text(
                    "Or: pull shade → pencil / edit → drag Capture into the tiles",
                    style = MaterialTheme.typography.bodySmall,
                    color = extras.tertiaryText,
                )
            }

            Spacer(modifier = Modifier.height(4.dp))

            Text(
                "2. Home widget",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                "Long-press the home screen → Widgets → Atoms Capture. " +
                    "Or tap below and confirm the pin.",
                style = MaterialTheme.typography.bodySmall,
                color = extras.secondaryText,
            )
            if (widgetDone) {
                Text(
                    "Added · tap Capture on your home screen",
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
                    Text("Add home widget", style = MaterialTheme.typography.labelLarge)
                }
            }

            Text(
                "Also works: long-press the app icon → Capture",
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
            contentDescription = if (done) "Done" else "Not done",
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
                Text("OK")
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
