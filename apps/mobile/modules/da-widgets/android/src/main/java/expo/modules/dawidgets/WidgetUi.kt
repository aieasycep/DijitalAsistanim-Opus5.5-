package expo.modules.dawidgets

import android.content.Context
import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.Dp
import androidx.glance.ColorFilter
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.appwidget.cornerRadius
import androidx.glance.layout.size
import androidx.glance.unit.ColorProvider
import java.util.Date

/** The launcher's own widget radius on API 31+ (`system_app_widget_background_radius`). */
internal fun GlanceModifier.appWidgetRadius(): GlanceModifier =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        cornerRadius(android.R.dimen.system_app_widget_background_radius)
    } else {
        this
    }

/** `auto_awesome`, tinted. */
@Composable
internal fun Sparkle(size: Dp, tint: ColorProvider) {
    Image(
        provider = ImageProvider(R.drawable.da_widget_sparkle),
        contentDescription = null,
        modifier = GlanceModifier.size(size),
        colorFilter = ColorFilter.tint(tint),
    )
}

internal data class StatusCopy(val title: String, val message: String, val url: String?)

/** First run, signed out, not connected and stale (§11.4): the same copy on both sizes. */
internal fun statusCopy(context: Context, snapshot: Snapshot?, now: Date, family: String): StatusCopy? {
    val lang = DaText.language(snapshot)
    val name = DaText.t("gallery.name", lang)
    return when {
        snapshot == null -> StatusCopy(name, DaText.t("firstRun", lang), null)
        snapshot.state == "signed_out" -> StatusCopy(name, DaText.t("signIn", lang), DaLinks.today(context, family))
        snapshot.state == "no_sources" -> StatusCopy(name, DaText.t("connect", lang), DaLinks.accounts(context, family))
        snapshot.isStale(now) -> StatusCopy(name, DaText.t("staleBody", lang), DaLinks.today(context, family))
        else -> null
    }
}

/** "Son güncelleme 07:58" once the snapshot is older than 6 h. */
internal fun agingLine(snapshot: Snapshot, now: Date, lang: String): String? =
    if (snapshot.isAging(now)) {
        DaText.t("staleMeta", lang, mapOf("time" to DaText.clock(snapshot.generatedAt)))
    } else {
        null
    }
