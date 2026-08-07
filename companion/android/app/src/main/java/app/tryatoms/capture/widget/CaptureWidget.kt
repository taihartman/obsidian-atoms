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
import androidx.glance.layout.Box
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
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import app.tryatoms.capture.QuickCaptureActivity
import app.tryatoms.capture.data.CaptureRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Simple home chip: label + plus. Tap opens floating capture strip.
 * Avoids cramped multi-line overflow on small cells.
 */
class CaptureWidget : GlanceAppWidget() {
    override suspend fun provideGlance(
        context: Context,
        id: GlanceId,
    ) {
        val ready =
            withContext(Dispatchers.IO) {
                CaptureRepository(context).isLinked()
            }

        provideContent {
            GlanceTheme {
                WidgetContent(ready = ready)
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
private fun WidgetContent(ready: Boolean) {
    val bg = ColorProvider(Color(0xFF1C1C1E))
    val titleColor = ColorProvider(Color.White)
    val accent = ColorProvider(Color(0xFF0A84FF))
    val muted = ColorProvider(Color(0x99EBEBF5))

    Box(
        modifier =
            GlanceModifier
                .fillMaxSize()
                .cornerRadius(16.dp)
                .background(bg)
                .clickable(actionStartActivity<QuickCaptureActivity>())
                .padding(16.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        Row(
            modifier = GlanceModifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = GlanceModifier.defaultWeight()) {
                Text(
                    text = "Capture",
                    maxLines = 1,
                    style =
                        TextStyle(
                            color = titleColor,
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                        ),
                )
                Spacer(GlanceModifier.height(4.dp))
                Text(
                    text = if (ready) "Tap to add a thought" else "Tap to set up",
                    maxLines = 1,
                    style =
                        TextStyle(
                            color = muted,
                            fontSize = 12.sp,
                        ),
                )
            }
            Spacer(GlanceModifier.width(12.dp))
            Text(
                text = "+",
                style =
                    TextStyle(
                        color = accent,
                        fontSize = 32.sp,
                        fontWeight = FontWeight.Normal,
                    ),
            )
        }
    }
}

class CaptureWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = CaptureWidget()
}
