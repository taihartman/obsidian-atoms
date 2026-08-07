package app.tryatoms.capture.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import app.tryatoms.capture.ui.theme.AtomsShapes
import app.tryatoms.capture.ui.theme.AtomsThemeAccess
import app.tryatoms.capture.ui.theme.atomsFieldColors
import app.tryatoms.capture.ui.theme.atomsPrimaryButtonColors
import app.tryatoms.capture.ui.theme.atomsQuietButtonColors
import app.tryatoms.capture.ui.theme.claimSerifStyle
import app.tryatoms.capture.ui.theme.kickerStyle
import kotlinx.coroutines.delay

@Composable
fun QuickCaptureScreen(
    draft: String,
    onDraftChange: (String) -> Unit,
    linked: Boolean,
    vaultName: String?,
    busy: Boolean,
    error: String?,
    onCapture: () -> Unit,
    onOpenHub: () -> Unit,
    onCancel: () -> Unit,
) {
    val extras = AtomsThemeAccess.extras
    val focusRequester = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current

    LaunchedEffect(linked) {
        if (linked) {
            delay(80)
            focusRequester.requestFocus()
            keyboard?.show()
        }
    }

    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .imePadding()
                .padding(horizontal = 16.dp, vertical = 20.dp)
                .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("CAPTURE", style = kickerStyle)
        Text(
            "“What’s on your mind?”",
            style = claimSerifStyle,
        )
        if (linked && vaultName != null) {
            Text(
                vaultName,
                style = MaterialTheme.typography.bodySmall,
                color = extras.secondaryText,
            )
        }

        if (!linked) {
            Card(
                shape = AtomsShapes.card,
                colors = CardDefaults.cardColors(containerColor = extras.waitingFill),
                border = BorderStroke(1.dp, extras.waitingBorder),
                elevation = CardDefaults.cardElevation(0.dp),
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text(
                        "Link a vault first",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        "Open Atoms Capture once to choose your vault. Then the widget and shortcut work in one tap.",
                        style = MaterialTheme.typography.bodySmall,
                        color = extras.secondaryText,
                    )
                    Button(
                        onClick = onOpenHub,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                        shape = AtomsShapes.button,
                        colors = atomsPrimaryButtonColors(),
                    ) {
                        Text("Open Atoms Capture", style = MaterialTheme.typography.labelLarge)
                    }
                }
            }
            TextButton(onClick = onCancel, colors = atomsQuietButtonColors()) {
                Text("Cancel")
            }
            return@Column
        }

        if (error != null) {
            Card(
                shape = AtomsShapes.card,
                colors = CardDefaults.cardColors(containerColor = extras.errorFill),
                border = BorderStroke(1.dp, extras.errorBorder),
                elevation = CardDefaults.cardElevation(0.dp),
            ) {
                Text(
                    error,
                    modifier = Modifier.padding(16.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }

        OutlinedTextField(
            value = draft,
            onValueChange = onDraftChange,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 140.dp)
                    .focusRequester(focusRequester),
            enabled = !busy,
            placeholder = {
                Text("Type freely…", color = extras.tertiaryText)
            },
            shape = AtomsShapes.field,
            colors = atomsFieldColors(),
            textStyle = MaterialTheme.typography.bodyLarge,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions =
                KeyboardActions(
                    onDone = {
                        if (draft.isNotBlank() && !busy) onCapture()
                    },
                ),
        )

        Button(
            onClick = onCapture,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            enabled = !busy && draft.isNotBlank(),
            shape = AtomsShapes.button,
            colors = atomsPrimaryButtonColors(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        ) {
            Text(
                if (busy) "Saving…" else "Capture",
                style = MaterialTheme.typography.labelLarge,
            )
        }

        TextButton(onClick = onCancel, colors = atomsQuietButtonColors()) {
            Text("Cancel")
        }

        Spacer(modifier = Modifier.height(24.dp))
    }
}
