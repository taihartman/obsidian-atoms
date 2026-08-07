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
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import app.tryatoms.capture.QuickCaptureActivity
import app.tryatoms.capture.data.CaptureRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Home-screen widget: tap anywhere → QuickCaptureActivity.
 * Not an in-widget IME (OEM reliability).
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
                    "Link vault in app"
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
    val bg = ColorProvider(Color.Black)
    val titleColor = ColorProvider(Color.White)
    val subColor = ColorProvider(Color(0x99EBEBF5))
    val accent = ColorProvider(Color(0xFF0A84FF))

    Column(
        modifier =
            GlanceModifier
                .fillMaxSize()
                .background(bg)
                .padding(14.dp)
                .clickable(actionStartActivity<QuickCaptureActivity>()),
        verticalAlignment = Alignment.CenterVertically,
        horizontalAlignment = Alignment.Start,
    ) {
        Text(
            text = "CAPTURE",
            style =
                TextStyle(
                    color = ColorProvider(Color(0xFFBF5AF2)),
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                ),
        )
        Spacer(GlanceModifier.height(6.dp))
        Text(
            text = "Capture",
            style =
                TextStyle(
                    color = titleColor,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                ),
        )
        Spacer(GlanceModifier.height(4.dp))
        Text(
            text = subtitle,
            style =
                TextStyle(
                    color = subColor,
                    fontSize = 12.sp,
                ),
        )
        Spacer(GlanceModifier.height(8.dp))
        Text(
            text = "Tap to type",
            style =
                TextStyle(
                    color = accent,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                ),
        )
    }
}

class CaptureWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = CaptureWidget()
}
