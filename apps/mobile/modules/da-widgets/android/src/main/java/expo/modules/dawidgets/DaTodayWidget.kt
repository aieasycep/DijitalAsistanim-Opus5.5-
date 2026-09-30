package expo.modules.dawidgets

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.ColorFilter
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalSize
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
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
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.semantics.contentDescription
import androidx.glance.semantics.semantics
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import expo.modules.dawidgets.generated.DaColors
import java.util.Date

/**
 * M-WGT-08 · Android 4×2 "Bugün": the briefing headline plus up to two priority chips and "+k".
 * Resizable; below 4 columns only the headline and one chip remain. Read-only.
 */
class DaTodayWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Responsive(setOf(NARROW, WIDE))

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent { TodayContent(context) }
    }

    companion object {
        const val FAMILY = "android_4x2"
        val NARROW = DpSize(180.dp, 110.dp)
        val WIDE = DpSize(250.dp, 110.dp)
    }
}

private data class Chip(val text: String, val critical: Boolean, val url: String?)

private data class Play(val url: String, val label: String)

private data class TodayCopy(
    val headline: String,
    val chips: List<Chip>,
    val play: Play?,
    val url: String?,
    val meta: String?,
)

private fun todayCopy(context: Context, snapshot: Snapshot?, now: Date, wide: Boolean): TodayCopy {
    val family = DaTodayWidget.FAMILY
    val lang = DaText.language(snapshot)
    val status = statusCopy(context, snapshot, now, family)
    if (status != null || snapshot == null) {
        return TodayCopy(status?.message ?: DaText.t("firstRun", lang), emptyList(), null, status?.url, null)
    }
    val briefing = snapshot.briefing
    val headline = when {
        briefing?.status == "scheduled" -> DaText.t("large.scheduled", lang, mapOf("time" to (briefing?.timeLabel ?: "")))
        briefing?.status == "generating" -> DaText.upper(DaText.t("large.generating", lang), lang)
        briefing != null -> DaText.t("large.briefingCount", lang, mapOf("count" to briefing.itemCount))
        snapshot.priorities.isEmpty() && snapshot.counts.important == 0 -> DaText.t("empty", lang)
        else -> DaText.t("generic", lang, mapOf("count" to snapshot.counts.important))
    }
    val ready = briefing != null && briefing.status == "ready"
    val minutes = briefing?.audioMinutes
    val play = if (snapshot.isPro && ready && briefing != null && minutes != null) {
        DaLinks.url(context, "${briefing.deeplink}/listen?autoplay=1", family)?.let {
            Play(it, DaText.t("a11y.listen", lang, mapOf("minutes" to minutes)))
        }
    } else {
        null
    }
    val maxChips = if (wide) 2 else 1
    val chips = if (snapshot.detailMode == "generic") {
        listOf(
            Chip(DaText.t("android.importantChip", lang, mapOf("count" to snapshot.counts.important)), false, null),
            Chip(DaText.t("android.meetingChip", lang, mapOf("count" to snapshot.counts.eventsToday)), false, null),
            Chip(DaText.t("android.followUpChip", lang, mapOf("count" to snapshot.counts.followUps)), false, null),
        ).take(if (wide) 3 else 1)
    } else {
        val shown = snapshot.priorities.take(maxChips).map { priority ->
            val badge = DaText.t(DaText.badgeKey(priority.badge), lang)
            val text = if (snapshot.detailMode == "full") {
                priority.chipFull ?: priority.titleFull ?: badge
            } else {
                listOfNotNull(badge, priority.timeLabel).joinToString(" · ")
            }
            Chip(text, priority.urgency == "urgent", DaLinks.url(context, priority.deeplink, family))
        }
        val more = snapshot.counts.important - shown.size
        if (more > 0 && shown.isNotEmpty()) {
            shown + Chip(DaText.t("android.more", lang, mapOf("count" to more)), false, DaLinks.today(context, family))
        } else {
            shown
        }
    }
    val url = if (ready && briefing != null) DaLinks.url(context, briefing.deeplink, family) else DaLinks.today(context, family)
    return TodayCopy(headline, chips, play, url, agingLine(snapshot, now, lang))
}

@Composable
private fun TodayContent(context: Context) {
    val snapshot = SnapshotStore.load(context)
    val lang = DaText.language(snapshot)
    val wide = LocalSize.current.width >= DaTodayWidget.WIDE.width
    val copy = todayCopy(context, snapshot, Date(), wide)
    Column(
        modifier = GlanceModifier.fillMaxSize()
            .background(DaColors.surface)
            .appWidgetRadius()
            .padding(14.dp)
            .clickable(actionStartActivity(DaLinks.intent(context, copy.url)))
            .semantics { contentDescription = listOfNotNull(copy.headline, copy.meta).joinToString(", ") },
    ) {
        Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = GlanceModifier.size(22.dp).background(DaColors.brandSoft).cornerRadius(6.dp),
                contentAlignment = Alignment.Center,
            ) {
                Sparkle(14.dp, DaColors.brandPrimary)
            }
            Spacer(GlanceModifier.width(6.dp))
            Text(
                text = DaText.t("gallery.name", lang),
                style = TextStyle(color = DaColors.textAccent, fontSize = 12.sp, fontWeight = FontWeight.Bold),
                maxLines = 1,
            )
            Spacer(GlanceModifier.defaultWeight())
            copy.play?.let { play ->
                Box(
                    modifier = GlanceModifier.size(32.dp)
                        .background(DaColors.brandSoft)
                        .cornerRadius(16.dp)
                        .clickable(actionStartActivity(DaLinks.intent(context, play.url)))
                        .semantics { contentDescription = play.label },
                    contentAlignment = Alignment.Center,
                ) {
                    Image(
                        provider = ImageProvider(R.drawable.da_widget_play),
                        contentDescription = null,
                        modifier = GlanceModifier.size(16.dp),
                        colorFilter = ColorFilter.tint(DaColors.brandOnSoft),
                    )
                }
            }
        }
        Spacer(GlanceModifier.height(8.dp))
        Text(
            text = copy.headline,
            style = TextStyle(color = DaColors.textPrimary, fontSize = 17.sp, fontWeight = FontWeight.Bold),
            maxLines = 2,
        )
        copy.meta?.let {
            Text(text = it, style = TextStyle(color = DaColors.textTertiaryStrong, fontSize = 11.sp), maxLines = 1)
        }
        Spacer(GlanceModifier.defaultWeight())
        Row(verticalAlignment = Alignment.CenterVertically) {
            copy.chips.forEachIndexed { index, chip ->
                if (index > 0) Spacer(GlanceModifier.width(6.dp))
                ChipView(context, chip)
            }
        }
    }
}

@Composable
private fun ChipView(context: Context, chip: Chip) {
    var modifier = GlanceModifier
        .background(if (chip.critical) DaColors.toneCriticalSoft else DaColors.toneNeutralSoft)
        .cornerRadius(12.dp)
        .padding(horizontal = 10.dp, vertical = 5.dp)
        .semantics { contentDescription = chip.text }
    if (chip.url != null) modifier = modifier.clickable(actionStartActivity(DaLinks.intent(context, chip.url)))
    Text(
        text = chip.text,
        modifier = modifier,
        style = TextStyle(
            color = if (chip.critical) DaColors.toneCriticalText else DaColors.toneNeutralText,
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
        ),
        maxLines = 1,
    )
}
