package expo.modules.notificationintelligence

import android.app.Notification
import android.content.pm.PackageManager
import android.content.res.Resources
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.lang.ref.WeakReference
import java.util.TimeZone

/**
 * The notification listener (ADR-12, SCREEN_AND_FLOW_MAP §9). It runs only after the user granted
 * notification access in the system settings and switched the analysis on in the app. Each posted
 * notification is evaluated in memory by [SignalExtractor]; only the resulting structured signal
 * is written to the [EncryptedBuffer]. The title and text are never stored, logged or uploaded.
 */
class DaNotificationListenerService : NotificationListenerService() {
  override fun onListenerConnected() {
    super.onListenerConnected()
    current = WeakReference(this)
    NiEvents.grantChanged(true)
  }

  override fun onListenerDisconnected() {
    current = null
    super.onListenerDisconnected()
  }

  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    if (sbn == null) return
    try {
      handle(sbn)
    } catch (_: Exception) {
      // Never crash the listener and never log: an exception message could carry content.
    }
  }

  private fun handle(sbn: StatusBarNotification) {
    val store = NiStore(this)
    val config = store.config(packageName)
    if (!config.enabled) return
    val pkg = sbn.packageName ?: return
    if (!PackageRules.isLocked(pkg, packageName)) store.recordSeen(pkg)

    val notification = sbn.notification ?: return
    val extras = notification.extras
    val text = extras?.getCharSequence(Notification.EXTRA_BIG_TEXT)
      ?: extras?.getCharSequence(Notification.EXTRA_TEXT)
    val input = NotificationInput(
      packageName = pkg,
      title = extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString(),
      text = text?.toString(),
      category = notification.category,
      visibilitySecret = notification.visibility == Notification.VISIBILITY_SECRET,
      ongoing = sbn.isOngoing,
      groupSummary = (notification.flags and Notification.FLAG_GROUP_SUMMARY) != 0,
      redacted = isRedacted(text),
      postedAtMillis = sbn.postTime,
    )
    val outcome = SignalExtractor(TimeZone.getDefault()).evaluate(input, config, labelOf(pkg))
    if (outcome is Outcome.Extracted && EncryptedBuffer(this).add(outcome.signal)) {
      NiEvents.signalsChanged()
    }
  }

  /**
   * Android 15 hides one-time codes from untrusted listeners and posts a system placeholder
   * instead (KNOWN_PLATFORM_LIMITATIONS). Such a notification is dropped, never parsed.
   */
  private fun isRedacted(text: CharSequence?): Boolean {
    if (Build.VERSION.SDK_INT < 35 || text == null) return false
    val placeholder = redactionPlaceholder ?: return false
    return text.toString() == placeholder
  }

  private val redactionPlaceholder: String? by lazy {
    val system = Resources.getSystem()
    val id = system.getIdentifier("redacted_notification_message", "string", "android")
    if (id == 0) null else runCatching { system.getString(id) }.getOrNull()
  }

  private fun labelOf(pkg: String): String = try {
    val info = packageManager.getApplicationInfo(pkg, 0)
    packageManager.getApplicationLabel(info).toString()
  } catch (_: PackageManager.NameNotFoundException) {
    pkg
  }

  companion object {
    private var current: WeakReference<DaNotificationListenerService>? = null

    /** `disable()`: asks the system to unbind the running listener until access is re-enabled. */
    fun unbind() {
      current?.get()?.let { service -> runCatching { service.requestUnbind() } }
      current = null
    }
  }
}

/** Service → module notifications (the module forwards them to JS as events). */
object NiEvents {
  @Volatile var onGrantChanged: ((Boolean) -> Unit)? = null
  @Volatile var onSignalsChanged: (() -> Unit)? = null

  fun grantChanged(granted: Boolean) {
    onGrantChanged?.invoke(granted)
  }

  fun signalsChanged() {
    onSignalsChanged?.invoke()
  }
}
