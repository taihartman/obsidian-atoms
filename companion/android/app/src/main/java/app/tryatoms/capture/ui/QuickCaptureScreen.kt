package app.tryatoms.capture.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.tryatoms.capture.ui.theme.AtomsColor
import app.tryatoms.capture.ui.theme.AtomsShapes
import app.tryatoms.capture.ui.theme.AtomsThemeAccess
import app.tryatoms.capture.ui.theme.ClaimSerif
import kotlinx.coroutines.delay

/**
 * Top-of-screen capture strip — not a full page.
 * Text field + native mic + send check.
 */
@Composable
fun QuickCaptureScreen(
    draft: String,
    onDraftChange: (String) -> Unit,
    linked: Boolean,
    vaultName: String?,
    busy: Boolean,
    error: String?,
    onCapture: () -> Unit,
    onVoice: () -> Unit,
    onOpenHub: () -> Unit,
    onDismiss: () -> Unit,
) {
    val extras = AtomsThemeAccess.extras
    val focusRequester = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current

    LaunchedEffect(linked) {
        if (linked) {
            delay(60)
            focusRequester.requestFocus()
            keyboard?.show()
        }
    }

    Box(
        modifier =
            Modifier
                .fillMaxSize()
                .imePadding()
                // Transparent — system dim from theme; tap empty area to dismiss
                .clickable(
                    indication = null,
                    interactionSource = remember { MutableInteractionSource() },
                    onClick = onDismiss,
                ),
    ) {
        Surface(
            modifier =
                Modifier
                    .align(Alignment.TopCenter)
                    .statusBarsPadding()
                    .padding(horizontal = 12.dp, vertical = 8.dp)
                    .fillMaxWidth()
                    .clickable(
                        indication = null,
                        interactionSource = remember { MutableInteractionSource() },
                        onClick = { /* consume — don't dismiss when tapping card */ },
                    ),
            shape = AtomsShapes.card,
            color = extras.card,
            tonalElevation = 0.dp,
            shadowElevation = 8.dp,
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text =
                            if (linked) {
                                "What’s on your mind?"
                            } else {
                                "Link a vault first"
                            },
                        style =
                            TextStyle(
                                fontFamily = ClaimSerif,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Normal,
                                color = MaterialTheme.colorScheme.onSurface,
                            ),
                    )
                    IconButton(
                        onClick = onDismiss,
                        modifier = Modifier.size(36.dp),
                    ) {
                        Icon(
                            Icons.Filled.Close,
                            contentDescription = "Close",
                            tint = extras.secondaryText,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                }

                if (!linked) {
                    Text(
                        "Open Atoms Capture once to choose your vault.",
                        style = MaterialTheme.typography.bodySmall,
                        color = extras.secondaryText,
                    )
                    TextButton(onClick = onOpenHub) {
                        Text("Open hub", color = MaterialTheme.colorScheme.primary)
                    }
                    return@Column
                }

                if (vaultName != null) {
                    Text(
                        vaultName,
                        style = MaterialTheme.typography.labelMedium,
                        color = extras.tertiaryText,
                    )
                }

                if (error != null) {
                    Text(
                        error,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    BasicTextField(
                        value = draft,
                        onValueChange = onDraftChange,
                        modifier =
                            Modifier
                                .weight(1f)
                                .heightIn(min = 44.dp, max = 120.dp)
                                .focusRequester(focusRequester)
                                .background(extras.elevated, AtomsShapes.field)
                                .padding(horizontal = 14.dp, vertical = 12.dp),
                        enabled = !busy,
                        textStyle =
                            TextStyle(
                                color = MaterialTheme.colorScheme.onSurface,
                                fontSize = 16.sp,
                                lineHeight = 22.sp,
                            ),
                        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                        keyboardActions =
                            KeyboardActions(
                                onSend = {
                                    if (draft.isNotBlank() && !busy) onCapture()
                                },
                            ),
                        decorationBox = { inner ->
                            Box {
                                if (draft.isEmpty()) {
                                    Text(
                                        "Type or tap the mic…",
                                        color = extras.tertiaryText,
                                        fontSize = 16.sp,
                                    )
                                }
                                inner()
                            }
                        },
                    )

                    // Native voice
                    IconButton(
                        onClick = onVoice,
                        enabled = !busy,
                        modifier =
                            Modifier
                                .size(44.dp)
                                .clip(CircleShape)
                                .background(extras.elevated),
                    ) {
                        Icon(
                            Icons.Filled.Mic,
                            contentDescription = "Voice",
                            tint = AtomsColor.Person,
                        )
                    }

                    // Send
                    IconButton(
                        onClick = onCapture,
                        enabled = !busy && draft.isNotBlank(),
                        modifier =
                            Modifier
                                .size(44.dp)
                                .clip(CircleShape)
                                .background(
                                    if (draft.isNotBlank() && !busy) {
                                        MaterialTheme.colorScheme.primary
                                    } else {
                                        extras.elevated
                                    },
                                ),
                    ) {
                        if (busy) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(22.dp),
                                strokeWidth = 2.dp,
                                color = MaterialTheme.colorScheme.onPrimary,
                            )
                        } else {
                            Icon(
                                Icons.Filled.Check,
                                contentDescription = "Send",
                                tint =
                                    if (draft.isNotBlank()) {
                                        MaterialTheme.colorScheme.onPrimary
                                    } else {
                                        extras.tertiaryText
                                    },
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(2.dp))
            }
        }
    }
}
