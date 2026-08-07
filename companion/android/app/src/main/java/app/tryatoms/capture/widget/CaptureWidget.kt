package app.tryatoms.capture.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.LocalContext
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Row
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import app.tryatoms.capture.QuickCaptureActivity

/**
 * One-line chip. Explicit intent → QuickCaptureActivity only (never MainActivity).
 */
class CaptureWidget : GlanceAppWidget() {
    override suspend fun provideGlance(
        context: Context,
        id: GlanceId,
    ) {
        provideContent {
            GlanceTheme {
                WidgetContent()
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
private fun WidgetContent() {
    val context = LocalContext.current
    val intent = QuickCaptureActivity.launchIntent(context)

    val bg = ColorProvider(Color(0xFF1C1C1E))
    val title = ColorProvider(Color.White)
    val accent = ColorProvider(Color(0xFF0A84FF))

    Box(
        modifier =
            GlanceModifier
                .fillMaxSize()
                .cornerRadius(16.dp)
                .background(bg)
                .clickable(actionStartActivity(intent))
                .padding(horizontal = 16.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            modifier = GlanceModifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "Capture",
                maxLines = 1,
                style =
                    TextStyle(
                        color = title,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                    ),
                modifier = GlanceModifier.defaultWeight(),
            )
            Text(
                text = "+",
                maxLines = 1,
                style =
                    TextStyle(
                        color = accent,
                        fontSize = 26.sp,
                        fontWeight = FontWeight.Medium,
                    ),
            )
        }
    }
}

class CaptureWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = CaptureWidget()
}
