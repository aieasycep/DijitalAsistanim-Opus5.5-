package expo.modules.dawidgets

import android.content.Context
import android.content.Intent
import android.net.Uri
import expo.modules.dawidgets.generated.DaStrings
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Widget copy from the generated `DaStrings` tables (@da/i18n `widgets.*`). */
object DaText {
    private val TR = Locale.forLanguageTag("tr-TR")

    /** The snapshot language; before the first write, the device language. */
    fun language(snapshot: Snapshot?): String =
        snapshot?.locale ?: if (Locale.getDefault().language == "en") "en" else "tr"

    /**
     * Formats `widgets.<key>`: `{arg}` placeholders, the flattened plural (`one` when the plural
     * argument is 1) and the Turkish `{time_loc}` ("07:30'da") derived from `time`.
     */
    fun t(key: String, lang: String, args: Map<String, Any> = emptyMap()): String {
        val table = if (lang == "en") DaStrings.en else DaStrings.tr
        val entry = table[key] ?: DaStrings.tr[key] ?: return ""
        val plural = entry.plural?.let { args[it] }
        var text = if (plural == 1) entry.one else entry.other
        val time = args["time"]
        if (time is String && text.contains("{time_loc}")) {
            text = text.replace("{time_loc}", trLocative(time))
        }
        for ((name, value) in args) text = text.replace("{$name}", value.toString())
        return text
    }

    /** Kickers and badges are upper-cased in the snapshot language ("SON TARİH"). */
    fun upper(text: String, lang: String): String = text.uppercase(if (lang == "en") Locale.US else TR)

    /** "07:30" → "07:30'da": the suffix follows the minutes, or the hour on the full hour. */
    fun trLocative(time: String): String {
        val parts = time.split(":")
        if (parts.size < 2) return time
        val hour = parts[0].takeLast(2).toIntOrNull() ?: return time
        val minute = parts[1].take(2).toIntOrNull() ?: return time
        if (hour !in 0..23 || minute !in 0..59) return time
        val suffix = if (minute == 0) DaStrings.trLocativeByHour[hour] else DaStrings.trLocativeByMinute[minute]
        return "$time'$suffix"
    }

    /** 24-hour clock in the device time zone (the snapshot's own labels are server-rendered). */
    fun clock(date: Date): String = SimpleDateFormat("HH:mm", Locale.US).format(date)

    fun badgeKey(badge: String): String = when (badge) {
        "ACİL" -> "badge.urgent"
        "SON TARİH" -> "badge.deadline"
        "TOPLANTI" -> "badge.meeting"
        "TAKİP" -> "badge.followUp"
        "KİŞİSEL" -> "badge.personal"
        else -> "badge.security"
    }
}

/** Widget deep links (§11.5): every URL carries `src=widget&w=<family>` for M-GL-07 analytics. */
object DaLinks {
    fun url(context: Context, deeplink: String?, family: String): String? {
        val base = deeplink ?: route(context, "today") ?: return null
        val separator = if (base.contains("?")) "&" else "?"
        return "$base${separator}src=widget&w=$family"
    }

    fun route(context: Context, path: String): String? =
        SnapshotStore.scheme(context)?.let { "$it://$path" }

    fun today(context: Context, family: String): String? = url(context, route(context, "today"), family)

    fun accounts(context: Context, family: String): String? =
        url(context, route(context, "settings/accounts"), family)

    /**
     * An explicit VIEW intent for this app only (`setPackage`); Glance wraps it in an immutable
     * PendingIntent. Without a URL (before the first write) the launcher intent opens the app.
     */
    fun intent(context: Context, url: String?): Intent {
        val intent = if (url == null) {
            context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent()
        } else {
            Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(context.packageName)
        }
        return intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
}
