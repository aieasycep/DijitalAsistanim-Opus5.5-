package expo.modules.dawidgets

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.padding
import androidx.glance.semantics.contentDescription
import androidx.glance.semantics.semantics
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import expo.modules.dawidgets.generated.DaColors
import java.util.Date

/**
 * M-WGT-07 · Android 2×2 "Sıradaki": the next meeting, otherwise the first priority, on the ink
 * card (dark mode adds the 1 px ring). Read-only; the whole widget opens the related screen.
 */
class DaNextWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent { NextContent(context) }
    }

    companion object {
        const val FAMILY = "android_2x2"
    }
}

private data class NextCopy(val kicker: String?, val title: String, val sub: String?, val url: String?)

private fun nextCopy(context: Context, snapshot: Snapshot?, now: Date): NextCopy {
    val family = DaNextWidget.FAMILY
    val lang = DaText.language(snapshot)
    val status = statusCopy(context, snapshot, now, family)
    if (status != null || snapshot == null) {
        return NextCopy(null, status?.title ?: DaText.t("gallery.name", lang), status?.message, status?.url)
    }
    val aging = agingLine(snapshot, now, lang)
    val meeting = snapshot.meetingAt(now)
    if (meeting != null) {
        val minutes = mapOf("minutes" to meeting.durationMin)
        val title = when (snapshot.detailMode) {
            "full" -> meeting.titleFull ?: DaText.t("private.meeting", lang, minutes)
            "title_only" -> DaText.t("private.meeting", lang, minutes)
            else -> DaText.t("large.meetingCount", lang, mapOf("count" to snapshot.counts.eventsToday))
        }
        val prep = if (snapshot.isPro && meeting.prepReady) {
            DaText.t("android.itemsReady", lang, mapOf("count" to (meeting.prepTopicCount ?: 0)))
        } else {
            null
        }
        return NextCopy(
            DaText.upper(DaText.t("lock.next", lang, mapOf("time" to meeting.timeLabel)), lang),
            title,
            prep ?: aging,
            DaLinks.url(context, meeting.deeplink, family),
        )
    }
    val priority = snapshot.priorities.firstOrNull()
    if (priority != null && snapshot.detailMode != "generic") {
        val badge = DaText.upper(DaText.t(DaText.badgeKey(priority.badge), lang), lang)
        val title = (if (snapshot.detailMode == "full") priority.titleFull else null)
            ?: priority.titlePrivate
            ?: badge
        return NextCopy(
            listOfNotNull(badge, priority.timeLabel).joinToString(" · "),
            title,
            aging,
            DaLinks.url(context, priority.deeplink, family),
        )
    }
    if (snapshot.counts.important > 0) {
        return NextCopy(
            DaText.upper(DaText.t("today", lang), lang),
            DaText.t("generic", lang, mapOf("count" to snapshot.counts.important)),
            aging,
            DaLinks.today(context, family),
        )
    }
    return NextCopy(null, DaText.t("lock.calm", lang), aging, DaLinks.today(context, family))
}

@Composable
private fun NextContent(context: Context) {
    val copy = nextCopy(context, SnapshotStore.load(context), Date())
    val description = listOfNotNull(copy.kicker, copy.title, copy.sub).joinToString(", ")
    Box(
        modifier = GlanceModifier.fillMaxSize()
            .background(DaColors.borderHairline)
            .appWidgetRadius()
            .padding(1.dp),
    ) {
        Column(
            modifier = GlanceModifier.fillMaxSize()
                .background(DaColors.surfaceInk)
                .appWidgetRadius()
                .padding(16.dp)
                .clickable(actionStartActivity(DaLinks.intent(context, copy.url)))
                .semantics { contentDescription = description },
            verticalAlignment = Alignment.Bottom,
        ) {
            Sparkle(18.dp, DaColors.toastIcon)
            Spacer(GlanceModifier.defaultWeight())
            copy.kicker?.let {
                Text(
                    text = it,
                    style = TextStyle(color = DaColors.textOnGradientTertiary, fontSize = 11.sp, fontWeight = FontWeight.Medium),
                    maxLines = 1,
                )
            }
            Text(
                text = copy.title,
                style = TextStyle(color = DaColors.textOnInk, fontSize = 15.sp, fontWeight = FontWeight.Bold),
                maxLines = 2,
            )
            copy.sub?.let {
                Text(
                    text = it,
                    style = TextStyle(color = DaColors.textOnGradientSecondary, fontSize = 11.sp),
                    maxLines = 1,
                )
            }
        }
    }
}
