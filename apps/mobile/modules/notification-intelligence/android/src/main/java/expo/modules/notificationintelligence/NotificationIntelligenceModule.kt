package expo.modules.notificationintelligence

import android.app.ActivityManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.service.notification.NotificationListenerService
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS API of the listener (SCREEN_AND_FLOW_MAP §9 "JS API"): grant state and the settings handoff,
 * the user's choices (enabled, mode, allowed packages), candidate apps for the picker and the
 * encrypted signal buffer, and the listener health with the rebind request (KPL-04). Events:
 * `onGrantChanged {granted}`, `onSignalsChanged` and `onListenerChanged` (bound / unbound).
 */
class NotificationIntelligenceModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  private var lastGranted: Boolean? = null

  override fun definition() = ModuleDefinition {
    Name("NotificationIntelligence")

    Events(EVENT_GRANT, EVENT_SIGNALS, EVENT_LISTENER)

    OnCreate {
      NiEvents.onGrantChanged = { granted -> emitGrant(granted) }
      NiEvents.onSignalsChanged = { sendEvent(EVENT_SIGNALS, emptyMap<String, Any>()) }
      NiEvents.onListenerChanged = { sendEvent(EVENT_LISTENER, emptyMap<String, Any>()) }
    }

    OnDestroy {
      NiEvents.onGrantChanged = null
      NiEvents.onSignalsChanged = null
      NiEvents.onListenerChanged = null
    }

    OnActivityEntersForeground {
      emitGrant(isGranted())
    }

    /** False on low-RAM (Go) devices, which do not offer notification-listener access. */
    Function("isAvailable") {
      val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      activityManager?.isLowRamDevice != true
    }

    Function("isGranted") { isGranted() }

    /** API 30+ opens our own detail page; older versions and failures fall back to the list. */
    Function("openSettings") {
      val component = ComponentName(context, DaNotificationListenerService::class.java)
      val detail = if (Build.VERSION.SDK_INT >= 30) {
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
          .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, component.flattenToString())
      } else {
        null
      }
      val list = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
      listOfNotNull(detail, list).any { intent -> launch(intent) }
    }

    Function("getState") {
      val store = NiStore(context)
      mapOf(
        "granted" to isGranted(),
        "enabled" to store.enabled,
        "mode" to store.mode.wire,
        "allowedPackages" to store.allowedPackages.sorted(),
      )
    }

    /**
     * KPL-04: the grant, whether the system has the service bound in this process, the last connect
     * and posted-notification times, and the [ListenerHealth] verdict.
     */
    Function("getListenerState") {
      val store = NiStore(context)
      val facts = ListenerFacts(
        granted = isGranted(),
        enabled = store.enabled,
        connected = DaNotificationListenerService.isConnected(),
        lastConnectedAt = store.lastConnectedAt,
        lastEventAt = store.lastEventAt,
      )
      mapOf(
        "granted" to facts.granted,
        "connected" to facts.connected,
        "lastConnectedAt" to facts.lastConnectedAt?.let { SignalExtractor.isoInstant(it) },
        "lastEventAt" to facts.lastEventAt?.let { SignalExtractor.isoInstant(it) },
        "health" to ListenerHealth.evaluate(facts, System.currentTimeMillis()).wire,
      )
    }

    /** Asks the system to bind the granted listener again (API 24+); false without the grant. */
    Function("requestRebind") {
      if (!isGranted()) return@Function false
      try {
        NotificationListenerService.requestRebind(
          ComponentName(context, DaNotificationListenerService::class.java),
        )
        true
      } catch (_: Exception) {
        false
      }
    }

    Function("setEnabled") { enabled: Boolean ->
      NiStore(context).enabled = enabled
    }

    Function("setMode") { mode: String ->
      NiStore(context).mode = NiMode.of(mode)
    }

    Function("setAllowedPackages") { packages: List<String> ->
      NiStore(context).allowedPackages =
        packages.filter { PACKAGE.matches(it) && !PackageRules.isLocked(it, context.packageName) }.toSet()
    }

    /** Launcher apps (visible through `<queries>`) plus packages seen in notifications. */
    Function("listCandidateApps") {
      val pm = context.packageManager
      val own = context.packageName
      val seen = NiStore(context).seen()
      val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
      val packages = pm.queryIntentActivities(launcher, 0).map { it.activityInfo.packageName }.toMutableSet()
      packages.addAll(seen.keys)
      packages.remove(own)
      packages.mapNotNull { pkg ->
        val label = try {
          pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
        } catch (_: Exception) {
          return@mapNotNull null
        }
        val stats = seen[pkg]
        mapOf(
          "package" to pkg,
          "label" to label.take(60),
          "seenCount" to (stats?.count ?: 0),
          "lastSeenAt" to stats?.lastSeenAt?.let { SignalExtractor.isoInstant(it) },
          "locked" to PackageRules.isLocked(pkg, own),
          "lockedGroup" to PackageRules.lockedGroup(pkg, own)?.wire,
        )
      }
    }

    Function("getLockedPackages") {
      PackageRules.LOCKED.map { (pkg, group) -> mapOf("package" to pkg, "group" to group.wire) }
    }

    Function("getPendingSignals") { limit: Int ->
      EncryptedBuffer(context).pending(limit.coerceIn(1, 200)).map { it.signal }
    }

    Function("getRecentSignals") { limit: Int ->
      EncryptedBuffer(context).recent(limit.coerceIn(1, 500)).map { entry ->
        entry.signal + mapOf("uploaded" to entry.uploaded)
      }
    }

    Function("markUploaded") { hashes: List<String> ->
      EncryptedBuffer(context).markUploaded(hashes)
    }

    Function("deleteSignal") { hash: String ->
      EncryptedBuffer(context).remove(hash)
    }

    Function("clearBuffer") {
      EncryptedBuffer(context).clear()
    }

    /** "Analizi durdur": off in the app and the running listener unbound. */
    Function("disable") {
      NiStore(context).enabled = false
      DaNotificationListenerService.unbind()
    }

    /** Sign-out: the settings, the seen counts and the buffer are wiped. */
    Function("reset") {
      NiStore(context).reset()
      EncryptedBuffer(context).clear()
    }
  }

  private fun isGranted(): Boolean =
    NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)

  private fun emitGrant(granted: Boolean) {
    if (lastGranted == granted) return
    lastGranted = granted
    sendEvent(EVENT_GRANT, mapOf("granted" to granted))
  }

  private fun launch(intent: Intent): Boolean {
    val activity = appContext.currentActivity
    return try {
      if (activity != null) {
        activity.startActivity(intent)
      } else {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
      true
    } catch (_: Exception) {
      false
    }
  }

  companion object {
    private const val EVENT_GRANT = "onGrantChanged"
    private const val EVENT_SIGNALS = "onSignalsChanged"
    private const val EVENT_LISTENER = "onListenerChanged"
    private val PACKAGE = Regex("^[a-zA-Z0-9_.]{3,120}$")
  }
}
