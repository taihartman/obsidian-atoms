package app.tryatoms.capture.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.Image
import androidx.glance.ImageProvider
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
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import app.tryatoms.capture.QuickCaptureActivity
import app.tryatoms.capture.R

/** Home chip: Capture + ↵ mark. Tap opens QuickCapture only. */
class CaptureHomeWidget : GlanceAppWidget() {
    override suspend fun provideGlance(
        context: Context,
        id: GlanceId,
    ) {
        provideContent {
            GlanceTheme { Content() }
        }
    }

    companion object {
        suspend fun updateAll(context: Context) {
            val manager = GlanceAppWidgetManager(context)
            val widget = CaptureHomeWidget()
            manager.getGlanceIds(CaptureHomeWidget::class.java).forEach { id ->
                widget.update(context, id)
            }
            val legacy = CaptureWidget()
            manager.getGlanceIds(CaptureWidget::class.java).forEach { id ->
                legacy.update(context, id)
            }
        }
    }
}

@Composable
private fun Content() {
    val context = LocalContext.current
    val intent = QuickCaptureActivity.launchIntent(context)

    Box(
        modifier =
            GlanceModifier
                .fillMaxSize()
                .cornerRadius(16.dp)
                .background(ColorProvider(Color(0xFF1C1C1E)))
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
                        color = ColorProvider(Color.White),
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                    ),
                modifier = GlanceModifier.defaultWeight(),
            )
            Spacer(GlanceModifier.width(8.dp))
            Image(
                provider = ImageProvider(R.drawable.ic_atoms_mark_blue),
                contentDescription = "Capture",
                modifier = GlanceModifier.size(28.dp),
            )
        }
    }
}

class CaptureHomeWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = CaptureHomeWidget()
}

/** Legacy provider — same UI; remove home pin labeled “old”. */
class CaptureWidget : GlanceAppWidget() {
    override suspend fun provideGlance(
        context: Context,
        id: GlanceId,
    ) {
        CaptureHomeWidget().provideGlance(context, id)
    }
}

class CaptureWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = CaptureWidget()
}
