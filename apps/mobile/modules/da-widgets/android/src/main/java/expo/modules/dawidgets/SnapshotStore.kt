package expo.modules.dawidgets

import android.content.Context
import org.json.JSONException
import org.json.JSONObject
import java.text.ParseException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * `WidgetSnapshotV1` (packages/validation/src/widget-snapshot.ts): the fields the Android layouts
 * render. The server already filtered titles by the detail level; absent fields stay null.
 */
data class Snapshot(
    val generatedAt: Date,
    val locale: String,
    val state: String,
    val detailMode: String,
    val entitlement: String,
    val counts: Counts,
    val briefing: Briefing?,
    val priorities: List<Priority>,
    val nextMeeting: Meeting?,
    val laterMeetings: List<Meeting>,
) {
    data class Counts(val important: Int, val eventsToday: Int, val followUps: Int)

    data class Briefing(
        val kind: String,
        val status: String,
        val timeLabel: String?,
        val itemCount: Int,
        val audioMinutes: Int?,
        val deeplink: String,
    )

    data class Priority(
        val badge: String,
        val urgency: String,
        val titleFull: String?,
        val chipFull: String?,
        val titlePrivate: String?,
        val timeLabel: String?,
        val deeplink: String,
    )

    data class Meeting(
        val startAt: Date,
        val endAt: Date,
        val timeLabel: String,
        val durationMin: Int,
        val titleFull: String?,
        val prepReady: Boolean,
        val prepTopicCount: Int?,
        val deeplink: String,
    )

    val isPro: Boolean get() = entitlement == "pro"

    /** The meeting running or next at [now]; later meetings take over without a new snapshot. */
    fun meetingAt(now: Date): Meeting? =
        (listOfNotNull(nextMeeting) + laterMeetings).firstOrNull { it.endAt.after(now) }

    /** Meeting starts/ends and the 6 h / 24 h staleness marks: when the layouts change. */
    fun boundaries(): List<Long> =
        (listOfNotNull(nextMeeting) + laterMeetings).flatMap { listOf(it.startAt.time, it.endAt.time) } +
            listOf(generatedAt.time + AGING_MS, generatedAt.time + STALE_MS)

    fun isAging(now: Date): Boolean = now.time - generatedAt.time > AGING_MS

    fun isStale(now: Date): Boolean = state == "stale" || now.time - generatedAt.time > STALE_MS

    companion object {
        const val AGING_MS = 6 * 3600 * 1000L
        const val STALE_MS = 24 * 3600 * 1000L

        /** Anything undecodable or of another version is null (the first-run layout). */
        fun parse(json: String): Snapshot? =
            try {
                val root = JSONObject(json)
                if (root.getInt("v") != 1) null else decode(root)
            } catch (error: JSONException) {
                null
            } catch (error: ParseException) {
                null
            }

        private fun decode(root: JSONObject): Snapshot {
            val counts = root.getJSONObject("counts")
            val priorities = root.getJSONArray("priorities")
            val later = root.getJSONArray("later_meetings")
            return Snapshot(
                generatedAt = parseDate(root.getString("generated_at")),
                locale = root.getString("locale"),
                state = root.getString("state"),
                detailMode = root.getString("detail_mode"),
                entitlement = root.getString("entitlement"),
                counts = Counts(
                    important = counts.getInt("important"),
                    eventsToday = counts.getInt("events_today"),
                    followUps = counts.getInt("follow_ups"),
                ),
                briefing = root.optObject("briefing")?.let {
                    Briefing(
                        kind = it.getString("kind"),
                        status = it.getString("status"),
                        timeLabel = it.optText("time_label"),
                        itemCount = it.getInt("item_count"),
                        audioMinutes = if (it.isNull("audio_minutes")) null else it.getInt("audio_minutes"),
                        deeplink = it.getString("deeplink"),
                    )
                },
                priorities = (0 until priorities.length()).map { index ->
                    val item = priorities.getJSONObject(index)
                    Priority(
                        badge = item.getString("badge"),
                        urgency = item.getString("urgency"),
                        titleFull = item.optText("title_full"),
                        chipFull = item.optText("chip_full"),
                        titlePrivate = item.optText("title_private"),
                        timeLabel = item.optText("time_label"),
                        deeplink = item.getString("deeplink"),
                    )
                },
                nextMeeting = root.optObject("next_meeting")?.let(::meeting),
                laterMeetings = (0 until later.length()).map { meeting(later.getJSONObject(it)) },
            )
        }

        private fun meeting(json: JSONObject) = Meeting(
            startAt = parseDate(json.getString("start_at")),
            endAt = parseDate(json.getString("end_at")),
            timeLabel = json.getString("time_label"),
            durationMin = json.getInt("duration_min"),
            titleFull = json.optText("title_full"),
            prepReady = json.getBoolean("prep_ready"),
            prepTopicCount = if (json.isNull("prep_topic_count")) null else json.getInt("prep_topic_count"),
            deeplink = json.getString("deeplink"),
        )

        /** ISO 8601 with an offset; fractional seconds (any precision) are dropped. */
        fun parseDate(raw: String): Date {
            val trimmed = raw.replace(Regex("\\.[0-9]+"), "")
            val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US)
            return format.parse(trimmed) ?: throw ParseException(raw, 0)
        }

        private fun JSONObject.optObject(key: String): JSONObject? =
            if (!has(key) || isNull(key)) null else getJSONObject(key)

        private fun JSONObject.optText(key: String): String? =
            if (!has(key) || isNull(key)) null else getString(key)
    }
}

/** SharedPreferences `da_widget` / `snapshot_v1` (§11.1), written only through `DaWidgets`. */
object SnapshotStore {
    private const val PREFS = "da_widget"
    private const val KEY = "snapshot_v1"
    private const val SCHEME_KEY = "scheme"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun write(context: Context, json: String, scheme: String) {
        prefs(context).edit().putString(KEY, json).putString(SCHEME_KEY, scheme).commit()
    }

    fun read(context: Context): String? = prefs(context).getString(KEY, null)

    fun load(context: Context): Snapshot? = read(context)?.let(Snapshot::parse)

    /** This build's URL scheme (`dijitalasistan`, `dijitalasistan-dev`, …). */
    fun scheme(context: Context): String? = prefs(context).getString(SCHEME_KEY, null)?.takeIf { it.isNotEmpty() }
}
