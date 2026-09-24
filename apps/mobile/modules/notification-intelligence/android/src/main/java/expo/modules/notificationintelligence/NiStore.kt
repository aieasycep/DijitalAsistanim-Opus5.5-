package expo.modules.notificationintelligence

import android.content.Context
import org.json.JSONObject

/**
 * Listener settings (enabled, mode, allowed packages) and per-package notification counts for the
 * app picker ("Son 7 günde {n} bildirim"). Only package names and counts are kept here; no
 * content. The service reads this on every notification, so writes take effect at once.
 */
class NiStore(context: Context) {
  private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  var enabled: Boolean
    get() = prefs.getBoolean(KEY_ENABLED, false)
    set(value) = prefs.edit().putBoolean(KEY_ENABLED, value).apply()

  var mode: NiMode
    get() = NiMode.of(prefs.getString(KEY_MODE, null))
    set(value) = prefs.edit().putString(KEY_MODE, value.wire).apply()

  var allowedPackages: Set<String>
    get() = prefs.getStringSet(KEY_ALLOWED, emptySet())?.toSet() ?: emptySet()
    set(value) = prefs.edit().putStringSet(KEY_ALLOWED, value.toSet()).apply()

  fun config(ownPackage: String) = NiConfig(enabled, mode, allowedPackages, ownPackage)

  /** Counts one notification from [packageName] (locked packages are never counted). */
  @Synchronized
  fun recordSeen(packageName: String, now: Long = System.currentTimeMillis()) {
    val seen = seen(now)
    val current = seen[packageName]
    seen[packageName] = Seen((current?.count ?: 0) + 1, now)
    writeSeen(seen)
  }

  data class Seen(val count: Int, val lastSeenAt: Long)

  /** Packages seen in the last 7 days. */
  @Synchronized
  fun seen(now: Long = System.currentTimeMillis()): MutableMap<String, Seen> {
    val raw = prefs.getString(KEY_SEEN, null) ?: return mutableMapOf()
    return try {
      val json = JSONObject(raw)
      json.keys().asSequence().mapNotNull { key ->
        val row = json.getJSONObject(key)
        val seen = Seen(row.getInt("n"), row.getLong("t"))
        if (now - seen.lastSeenAt < SEEN_WINDOW_MS) key to seen else null
      }.toMap(mutableMapOf())
    } catch (_: Exception) {
      mutableMapOf()
    }
  }

  private fun writeSeen(seen: Map<String, Seen>) {
    val json = JSONObject()
    seen.entries.sortedByDescending { it.value.lastSeenAt }.take(MAX_SEEN).forEach { (key, value) ->
      json.put(key, JSONObject().put("n", value.count).put("t", value.lastSeenAt))
    }
    prefs.edit().putString(KEY_SEEN, json.toString()).apply()
  }

  /** Sign-out: the next account starts with the feature off and no history. */
  fun reset() {
    prefs.edit().clear().apply()
  }

  companion object {
    private const val PREFS = "da.ni.settings"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_MODE = "mode"
    private const val KEY_ALLOWED = "allowed_packages"
    private const val KEY_SEEN = "seen"
    private const val MAX_SEEN = 300
    private const val SEEN_WINDOW_MS = 7L * 24 * 60 * 60 * 1000
  }
}
