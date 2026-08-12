package app.tryatoms.capture.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.tryatoms.capture.R
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.tryatoms.capture.ui.theme.AtomsColor
import app.tryatoms.capture.ui.theme.AtomsShapes
import app.tryatoms.capture.ui.theme.AtomsThemeAccess
import app.tryatoms.capture.ui.theme.ClaimSerif
import kotlinx.coroutines.delay

/**
 * Full-width top bar (edge to edge). Mic listens in-place — no system voice sheet.
 */
@Composable
fun QuickCaptureScreen(
    fieldValue: TextFieldValue,
    onFieldChange: (TextFieldValue) -> Unit,
    linked: Boolean,
    vaultName: String?,
    busy: Boolean,
    listening: Boolean,
    error: String?,
    onCapture: () -> Unit,
    onToggleVoice: () -> Unit,
    onOpenHub: () -> Unit,
    onClose: () -> Unit,
) {
    val extras = AtomsThemeAccess.extras
    val focusRequester = remember { FocusRequester() }
    val focusManager = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current

    // Keyboard steals audio focus on some OEMs — hide it while listening.
    LaunchedEffect(linked, listening) {
        if (!linked) return@LaunchedEffect
        if (listening) {
            keyboard?.hide()
            focusManager.clearFocus(force = true)
        } else {
            delay(80)
            focusRequester.requestFocus()
            keyboard?.show()
        }
    }

    // Floating card under the status bar — inset + fully rounded (not flat to the top edge)
    Surface(
        modifier =
            Modifier
                .statusBarsPadding()
                .padding(horizontal = 12.dp, vertical = 8.dp)
                .fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        color = extras.card,
        tonalElevation = 0.dp,
        shadowElevation = 16.dp,
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text =
                            when {
                                !linked -> stringResource(R.string.quick_link_first)
                                listening -> stringResource(R.string.quick_listening)
                                else -> stringResource(R.string.quick_whats_on_mind)
                            },
                        style =
                            TextStyle(
                                fontFamily = ClaimSerif,
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Normal,
                                color = MaterialTheme.colorScheme.onSurface,
                            ),
                    )
                    if (linked && vaultName != null && !listening) {
                        Text(
                            vaultName,
                            style = MaterialTheme.typography.labelMedium,
                            color = extras.tertiaryText,
                            modifier = Modifier.padding(top = 2.dp),
                        )
                    }
                }
                IconButton(
                    onClick = onClose,
                    modifier = Modifier.size(40.dp),
                ) {
                    Icon(
                        Icons.Filled.Close,
                        contentDescription = stringResource(R.string.quick_cd_close),
                        tint = extras.secondaryText,
                    )
                }
            }

            if (!linked) {
                Text(
                    stringResource(R.string.quick_open_hub_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = extras.secondaryText,
                )
                TextButton(onClick = onOpenHub) {
                    Text(stringResource(R.string.quick_open_hub), color = MaterialTheme.colorScheme.primary)
                }
                return@Column
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
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                BasicTextField(
                    value = fieldValue,
                    onValueChange = onFieldChange,
                    modifier =
                        Modifier
                            .weight(1f)
                            .heightIn(min = 52.dp, max = 160.dp)
                            .focusRequester(focusRequester)
                            .background(extras.elevated, AtomsShapes.field)
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                    enabled = !busy,
                    textStyle =
                        TextStyle(
                            color = MaterialTheme.colorScheme.onSurface,
                            fontSize = 17.sp,
                            lineHeight = 24.sp,
                        ),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions =
                        KeyboardActions(
                            onSend = {
                                if (fieldValue.text.isNotBlank() && !busy) onCapture()
                            },
                        ),
                    decorationBox = { inner ->
                        Box {
                            if (fieldValue.text.isEmpty()) {
                                Text(
                                    if (listening) {
                                        stringResource(R.string.quick_speak_now)
                                    } else {
                                        stringResource(R.string.quick_type_or_mic)
                                    },
                                    color = extras.tertiaryText,
                                    fontSize = 17.sp,
                                )
                            }
                            inner()
                        }
                    },
                )

                IconButton(
                    onClick = onToggleVoice,
                    enabled = !busy,
                    modifier =
                        Modifier
                            .size(48.dp)
                            .clip(CircleShape)
                            .background(
                                if (listening) {
                                    AtomsColor.Person.copy(alpha = 0.25f)
                                } else {
                                    extras.elevated
                                },
                            ),
                ) {
                    Icon(
                        if (listening) Icons.Filled.Stop else Icons.Filled.Mic,
                        contentDescription =
                            if (listening) {
                                stringResource(R.string.quick_cd_stop)
                            } else {
                                stringResource(R.string.quick_cd_voice)
                            },
                        tint = if (listening) AtomsColor.Person else AtomsColor.Person,
                    )
                }

                IconButton(
                    onClick = onCapture,
                    enabled = !busy && fieldValue.text.isNotBlank(),
                    modifier =
                        Modifier
                            .size(48.dp)
                            .clip(CircleShape)
                            .background(
                                if (fieldValue.text.isNotBlank() && !busy) {
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
                            contentDescription = stringResource(R.string.quick_cd_send),
                            tint =
                                if (fieldValue.text.isNotBlank()) {
                                    MaterialTheme.colorScheme.onPrimary
                                } else {
                                    extras.tertiaryText
                                },
                        )
                    }
                }
            }
        }
    }
}
