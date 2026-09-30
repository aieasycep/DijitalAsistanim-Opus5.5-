package expo.modules.daplatform

/**
 * The pure rules of the `da-platform` module (no Android imports, so the JVM tests in
 * `modules/notification-intelligence/jvm-test` run them without the SDK): the wire values the JS
 * side reads and the order of the system settings screens each handoff tries.
 */
object PlatformRules {
  /** Android 12 (API 31) introduced the "Alarms & reminders" special access. */
  const val EXACT_ALARM_API = 31

  const val ACTION_REQUEST_SCHEDULE_EXACT_ALARM = "android.settings.REQUEST_SCHEDULE_EXACT_ALARM"
  const val ACTION_APPLICATION_DETAILS_SETTINGS = "android.settings.APPLICATION_DETAILS_SETTINGS"
  const val ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS =
    "android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS"

  /** A settings screen: the intent action and whether it takes the `package:` URI of the app. */
  data class SettingsTarget(val action: String, val packageUri: Boolean)

  /**
   * `granted` / `denied` on Android 12+, where `AlarmManager.canScheduleExactAlarms()` decides;
   * `not_required` below, where exact alarms need no grant.
   */
  fun exactAlarmState(sdkInt: Int, canScheduleExactAlarms: Boolean): String = when {
    sdkInt < EXACT_ALARM_API -> "not_required"
    canScheduleExactAlarms -> "granted"
    else -> "denied"
  }

  /**
   * `exempt` when the app is on the battery-optimisation allow-list, `optimized` when it is not,
   * `unknown` when no PowerManager answered.
   */
  fun batteryOptimization(ignoring: Boolean?): String = when (ignoring) {
    null -> "unknown"
    true -> "exempt"
    false -> "optimized"
  }

  /** The app's own "Alarms & reminders" page first; the app details page as the fallback. */
  fun exactAlarmTargets(sdkInt: Int): List<SettingsTarget> {
    val details = SettingsTarget(ACTION_APPLICATION_DETAILS_SETTINGS, packageUri = true)
    return if (sdkInt >= EXACT_ALARM_API) {
      listOf(SettingsTarget(ACTION_REQUEST_SCHEDULE_EXACT_ALARM, packageUri = true), details)
    } else {
      listOf(details)
    }
  }

  /**
   * The battery-optimisation list (no direct exemption prompt: REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
   * is Play-restricted and never declared), then the app details page.
   */
  fun batteryTargets(): List<SettingsTarget> = listOf(
    SettingsTarget(ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS, packageUri = false),
    SettingsTarget(ACTION_APPLICATION_DETAILS_SETTINGS, packageUri = true),
  )
}
