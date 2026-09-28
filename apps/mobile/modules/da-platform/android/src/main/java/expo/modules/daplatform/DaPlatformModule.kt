package expo.modules.daplatform

import android.app.AlarmManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * `DaPlatform` on Android (KNOWN_PLATFORM_LIMITATIONS KPL-04, KPL-09): whether exact alarms may be
 * scheduled (`AlarmManager.canScheduleExactAlarms()`, API 31+) with the handoff to the app's
 * "Alarms & reminders" special-access page (`ACTION_REQUEST_SCHEDULE_EXACT_ALARM`), and whether the
 * app is exempt from battery optimisation with the handoff to the system list. Reading and opening
 * settings only: nothing here changes a system setting on the user's behalf.
 */
class DaPlatformModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  override fun definition() = ModuleDefinition {
    Name("DaPlatform")

    Function("getExactAlarmState") {
      val sdk = Build.VERSION.SDK_INT
      val alarms = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
      val allowed = if (sdk >= PlatformRules.EXACT_ALARM_API) {
        alarms?.canScheduleExactAlarms() == true
      } else {
        true
      }
      PlatformRules.exactAlarmState(sdk, allowed)
    }

    Function("openExactAlarmSettings") {
      PlatformRules.exactAlarmTargets(Build.VERSION.SDK_INT).any { target -> launch(target) }
    }

    Function("getBatteryOptimization") {
      val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
      PlatformRules.batteryOptimization(power?.isIgnoringBatteryOptimizations(context.packageName))
    }

    Function("openBatteryOptimizationSettings") {
      PlatformRules.batteryTargets().any { target -> launch(target) }
    }
  }

  /** Starts one settings screen; false when no activity resolved it. */
  private fun launch(target: PlatformRules.SettingsTarget): Boolean {
    val intent = Intent(target.action)
    if (target.packageUri) intent.data = Uri.parse("package:${context.packageName}")
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
}
