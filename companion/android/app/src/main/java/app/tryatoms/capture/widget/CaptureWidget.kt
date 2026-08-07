package app.tryatoms.capture.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import app.tryatoms.capture.QuickCaptureActivity
import app.tryatoms.capture.data.CaptureRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Compact home widget — tap opens the floating capture strip.
 */
class CaptureWidget : GlanceAppWidget() {
    override suspend fun provideGlance(
        context: Context,
        id: GlanceId,
    ) {
        val label =
            withContext(Dispatchers.IO) {
                val repo = CaptureRepository(context)
                if (repo.isLinked()) {
                    repo.vaultLabel() ?: "Ready"
                } else {
                    "Tap to set up"
                }
            }

        provideContent {
            GlanceTheme {
                WidgetContent(subtitle = label)
            }
        }
    }

    companion object {
        suspend fun updateAll(context: Context) {
            val manager = GlanceAppWidgetManager(context)
            val widget = CaptureWidget()
            manager.getGlanceIds(CaptureWidget::class.java).forEach { id ->
                widget.update(context, id)
            }
        }
    }
}

@Composable
private fun WidgetContent(subtitle: String) {
    val bg = ColorProvider(Color(0xFF1C1C1E))
    val titleColor = ColorProvider(Color.White)
    val subColor = ColorProvider(Color(0x99EBEBF5))
    val accent = ColorProvider(Color(0xFF0A84FF))
    val kicker = ColorProvider(Color(0xFFBF5AF2))

    Column(
        modifier =
            GlanceModifier
                .fillMaxSize()
                .cornerRadius(16.dp)
                .background(bg)
                .padding(horizontal = 16.dp, vertical = 14.dp)
                .clickable(actionStartActivity<QuickCaptureActivity>()),
        verticalAlignment = Alignment.CenterVertically,
        horizontalAlignment = Alignment.Start,
    ) {
        Text(
            text = "ATOMS",
            style =
                TextStyle(
                    color = kicker,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                ),
        )
        Spacer(GlanceModifier.height(6.dp))
        Row(
            modifier = GlanceModifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = GlanceModifier.defaultWeight()) {
                Text(
                    text = "Capture",
                    style =
                        TextStyle(
                            color = titleColor,
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Bold,
                        ),
                )
                Spacer(GlanceModifier.height(2.dp))
                Text(
                    text = subtitle,
                    maxLines = 1,
                    style =
                        TextStyle(
                            color = subColor,
                            fontSize = 12.sp,
                        ),
                )
            }
            Spacer(GlanceModifier.width(8.dp))
            Text(
                text = "＋",
                style =
                    TextStyle(
                        color = accent,
                        fontSize = 28.sp,
                        fontWeight = FontWeight.Medium,
                        textAlign = TextAlign.Center,
                    ),
            )
        }
    }
}

class CaptureWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = CaptureWidget()
}
