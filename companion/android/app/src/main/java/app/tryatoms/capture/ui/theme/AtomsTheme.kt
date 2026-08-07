package app.tryatoms.capture.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * Atoms design tokens — mirrored from docs/design-handoff/tokens/README.md
 * and styles.css UI kit. Dark is the primary product surface.
 */
object AtomsColor {
    val Tint = Color(0xFF0A84FF)
    val Person = Color(0xFFFF9F0A)
    val Work = Color(0xFF64D2FF)
    val Mind = Color(0xFFBF5AF2)
    val Done = Color(0xFF30D158)
    val Error = Color(0xFFFF453A)

    val BgDark = Color(0xFF000000)
    val CardDark = Color(0xFF1C1C1E)
    val ElevatedDark = Color(0xFF2C2C2E)
    val HairlineDark = Color(0x8C545458)
    val LabelDark = Color(0xFFFFFFFF)
    val SecondaryDark = Color(0x99EBEBF5) // ~60%
    val TertiaryDark = Color(0x52EBEBF5) // ~32%
    val OnAccent = Color(0xFFFFFFFF)

    val BgLight = Color(0xFFF2F2F7)
    val CardLight = Color(0xFFFFFFFF)
    val ElevatedLight = Color(0xFFE5E5EA)
    val HairlineLight = Color(0x33000000)
    val LabelLight = Color(0xFF000000)
    val SecondaryLight = Color(0x99000000)
    val TertiaryLight = Color(0x52000000)
}

@Immutable
data class AtomsExtraColors(
    val person: Color,
    val work: Color,
    val mind: Color,
    val done: Color,
    val hairline: Color,
    val card: Color,
    val elevated: Color,
    val secondaryText: Color,
    val tertiaryText: Color,
    val statusFill: Color,
    val statusBorder: Color,
    val successFill: Color,
    val successBorder: Color,
    val errorFill: Color,
    val errorBorder: Color,
    val waitingFill: Color,
    val waitingBorder: Color,
)

val LocalAtomsExtra =
    staticCompositionLocalOf {
        AtomsExtraColors(
            person = AtomsColor.Person,
            work = AtomsColor.Work,
            mind = AtomsColor.Mind,
            done = AtomsColor.Done,
            hairline = AtomsColor.HairlineDark,
            card = AtomsColor.CardDark,
            elevated = AtomsColor.ElevatedDark,
            secondaryText = AtomsColor.SecondaryDark,
            tertiaryText = AtomsColor.TertiaryDark,
            statusFill = AtomsColor.Tint.copy(alpha = 0.12f),
            statusBorder = AtomsColor.Tint.copy(alpha = 0.32f),
            successFill = AtomsColor.Done.copy(alpha = 0.12f),
            successBorder = AtomsColor.Done.copy(alpha = 0.32f),
            errorFill = AtomsColor.Error.copy(alpha = 0.12f),
            errorBorder = AtomsColor.Error.copy(alpha = 0.40f),
            waitingFill = AtomsColor.Person.copy(alpha = 0.10f),
            waitingBorder = AtomsColor.Person.copy(alpha = 0.28f),
        )
    }

object AtomsShapes {
    val badge = RoundedCornerShape(8.dp)
    val button = RoundedCornerShape(12.dp)
    val card = RoundedCornerShape(16.dp)
    val chip = RoundedCornerShape(980.dp)
    val field = RoundedCornerShape(14.dp)
}

val ClaimSerif = FontFamily.Serif

private val AtomsTypography =
    Typography(
        displayLarge =
            TextStyle(
                fontFamily = FontFamily.SansSerif,
                fontWeight = FontWeight.Bold,
                fontSize = 30.sp,
                letterSpacing = (-0.035).em,
                lineHeight = 36.sp,
            ),
        titleLarge =
            TextStyle(
                fontFamily = FontFamily.SansSerif,
                fontWeight = FontWeight.Bold,
                fontSize = 22.sp,
                letterSpacing = (-0.03).em,
                lineHeight = 28.sp,
            ),
        titleMedium =
            TextStyle(
                fontFamily = FontFamily.SansSerif,
                fontWeight = FontWeight.SemiBold,
                fontSize = 17.sp,
                letterSpacing = (-0.02).em,
                lineHeight = 22.sp,
            ),
        titleSmall =
            TextStyle(
                fontFamily = FontFamily.SansSerif,
                fontWeight = FontWeight.Medium,
                fontSize = 16.sp,
                letterSpacing = (-0.015).em,
                lineHeight = 21.sp,
            ),
        bodyLarge =
            TextStyle(
                fontFamily = FontFamily.SansSerif,
                fontWeight = FontWeight.Normal,
                fontSize = 16.sp,
                lineHeight = 22.sp,
            ),
        bodyMedium =
            TextStyle(
                fontFamily = FontFamily.SansSerif,
                fontWeight = FontWeight.Normal,
                fontSize = 14.sp,
                lineHeight = 20.sp,
            ),
        bodySmall =
            TextStyle(
                fontFamily = FontFamily.SansSerif,
                fontWeight = FontWeight.Normal,
                fontSize = 13.sp,
                lineHeight = 18.sp,
            ),
        labelLarge =
            TextStyle(
                fontFamily = FontFamily.SansSerif,
                fontWeight = FontWeight.SemiBold,
                fontSize = 15.sp,
                letterSpacing = (-0.01).em,
            ),
        labelMedium =
            TextStyle(
                fontFamily = FontFamily.SansSerif,
                fontWeight = FontWeight.SemiBold,
                fontSize = 12.sp,
                letterSpacing = (-0.01).em,
            ),
        labelSmall =
            TextStyle(
                fontFamily = FontFamily.SansSerif,
                fontWeight = FontWeight.SemiBold,
                fontSize = 11.sp,
                letterSpacing = 0.12.em,
            ),
    )

private fun darkScheme(): ColorScheme =
    darkColorScheme(
        primary = AtomsColor.Tint,
        onPrimary = AtomsColor.OnAccent,
        secondary = AtomsColor.ElevatedDark,
        onSecondary = AtomsColor.LabelDark,
        tertiary = AtomsColor.Mind,
        onTertiary = AtomsColor.OnAccent,
        background = AtomsColor.BgDark,
        onBackground = AtomsColor.LabelDark,
        surface = AtomsColor.BgDark,
        onSurface = AtomsColor.LabelDark,
        surfaceVariant = AtomsColor.CardDark,
        onSurfaceVariant = AtomsColor.SecondaryDark,
        outline = AtomsColor.HairlineDark,
        error = AtomsColor.Error,
        onError = AtomsColor.OnAccent,
        primaryContainer = AtomsColor.Tint.copy(alpha = 0.18f),
        onPrimaryContainer = AtomsColor.LabelDark,
        secondaryContainer = AtomsColor.CardDark,
        onSecondaryContainer = AtomsColor.SecondaryDark,
        errorContainer = AtomsColor.Error.copy(alpha = 0.14f),
        onErrorContainer = AtomsColor.Error,
    )

private fun lightScheme(): ColorScheme =
    lightColorScheme(
        primary = AtomsColor.Tint,
        onPrimary = AtomsColor.OnAccent,
        secondary = AtomsColor.ElevatedLight,
        onSecondary = AtomsColor.LabelLight,
        tertiary = Color(0xFF8E44AD),
        onTertiary = AtomsColor.OnAccent,
        background = AtomsColor.BgLight,
        onBackground = AtomsColor.LabelLight,
        surface = AtomsColor.BgLight,
        onSurface = AtomsColor.LabelLight,
        surfaceVariant = AtomsColor.CardLight,
        onSurfaceVariant = AtomsColor.SecondaryLight,
        outline = AtomsColor.HairlineLight,
        error = AtomsColor.Error,
        onError = AtomsColor.OnAccent,
        primaryContainer = AtomsColor.Tint.copy(alpha = 0.12f),
        onPrimaryContainer = AtomsColor.LabelLight,
        secondaryContainer = AtomsColor.CardLight,
        onSecondaryContainer = AtomsColor.SecondaryLight,
        errorContainer = AtomsColor.Error.copy(alpha = 0.10f),
        onErrorContainer = AtomsColor.Error,
    )

private fun extraDark() =
    AtomsExtraColors(
        person = AtomsColor.Person,
        work = AtomsColor.Work,
        mind = AtomsColor.Mind,
        done = AtomsColor.Done,
        hairline = AtomsColor.HairlineDark,
        card = AtomsColor.CardDark,
        elevated = AtomsColor.ElevatedDark,
        secondaryText = AtomsColor.SecondaryDark,
        tertiaryText = AtomsColor.TertiaryDark,
        statusFill = AtomsColor.Tint.copy(alpha = 0.12f),
        statusBorder = AtomsColor.Tint.copy(alpha = 0.32f),
        successFill = AtomsColor.Done.copy(alpha = 0.12f),
        successBorder = AtomsColor.Done.copy(alpha = 0.32f),
        errorFill = AtomsColor.Error.copy(alpha = 0.12f),
        errorBorder = AtomsColor.Error.copy(alpha = 0.40f),
        waitingFill = AtomsColor.Person.copy(alpha = 0.10f),
        waitingBorder = AtomsColor.Person.copy(alpha = 0.28f),
    )

private fun extraLight() =
    AtomsExtraColors(
        person = Color(0xFFC77C02),
        work = Color(0xFF0A7EA4),
        mind = Color(0xFF8E44AD),
        done = Color(0xFF248A3D),
        hairline = AtomsColor.HairlineLight,
        card = AtomsColor.CardLight,
        elevated = AtomsColor.ElevatedLight,
        secondaryText = AtomsColor.SecondaryLight,
        tertiaryText = AtomsColor.TertiaryLight,
        statusFill = AtomsColor.Tint.copy(alpha = 0.10f),
        statusBorder = AtomsColor.Tint.copy(alpha = 0.28f),
        successFill = AtomsColor.Done.copy(alpha = 0.12f),
        successBorder = AtomsColor.Done.copy(alpha = 0.28f),
        errorFill = AtomsColor.Error.copy(alpha = 0.10f),
        errorBorder = AtomsColor.Error.copy(alpha = 0.32f),
        waitingFill = AtomsColor.Person.copy(alpha = 0.12f),
        waitingBorder = AtomsColor.Person.copy(alpha = 0.28f),
    )

@Composable
fun AtomsTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colors = if (darkTheme) darkScheme() else lightScheme()
    val extra = if (darkTheme) extraDark() else extraLight()
    androidx.compose.runtime.CompositionLocalProvider(LocalAtomsExtra provides extra) {
        MaterialTheme(
            colorScheme = colors,
            typography = AtomsTypography,
            content = content,
        )
    }
}

object AtomsThemeAccess {
    val extras: AtomsExtraColors
        @Composable get() = LocalAtomsExtra.current
}

@Composable
fun atomsPrimaryButtonColors() =
    ButtonDefaults.buttonColors(
        containerColor = MaterialTheme.colorScheme.primary,
        contentColor = MaterialTheme.colorScheme.onPrimary,
        disabledContainerColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.35f),
        disabledContentColor = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.7f),
    )

@Composable
fun atomsSecondaryButtonColors() =
    ButtonDefaults.buttonColors(
        containerColor = AtomsThemeAccess.extras.elevated,
        contentColor = MaterialTheme.colorScheme.onSurface,
        disabledContainerColor = AtomsThemeAccess.extras.elevated.copy(alpha = 0.45f),
        disabledContentColor = AtomsThemeAccess.extras.secondaryText,
    )

@Composable
fun atomsQuietButtonColors() =
    ButtonDefaults.textButtonColors(
        contentColor = AtomsThemeAccess.extras.secondaryText,
    )

@Composable
fun atomsFlatCardColors() =
    CardDefaults.cardColors(
        containerColor = AtomsThemeAccess.extras.card,
        contentColor = MaterialTheme.colorScheme.onSurface,
    )

@Composable
fun atomsFieldColors() =
    OutlinedTextFieldDefaults.colors(
        focusedBorderColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.55f),
        unfocusedBorderColor = AtomsThemeAccess.extras.hairline,
        focusedContainerColor = AtomsThemeAccess.extras.card,
        unfocusedContainerColor = AtomsThemeAccess.extras.card,
        cursorColor = MaterialTheme.colorScheme.primary,
        focusedTextColor = MaterialTheme.colorScheme.onSurface,
        unfocusedTextColor = MaterialTheme.colorScheme.onSurface,
        focusedPlaceholderColor = AtomsThemeAccess.extras.tertiaryText,
        unfocusedPlaceholderColor = AtomsThemeAccess.extras.tertiaryText,
    )

val claimSerifStyle: TextStyle
    @Composable
    get() =
        TextStyle(
            fontFamily = ClaimSerif,
            fontWeight = FontWeight.Normal,
            fontSize = 18.sp,
            lineHeight = 26.sp,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Start,
        )

val kickerStyle: TextStyle
    @Composable
    get() =
        MaterialTheme.typography.labelSmall.copy(
            color = AtomsThemeAccess.extras.mind,
            fontWeight = FontWeight.SemiBold,
        )
