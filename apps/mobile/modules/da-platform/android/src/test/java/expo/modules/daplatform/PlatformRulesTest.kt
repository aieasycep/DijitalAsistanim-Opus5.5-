package expo.modules.daplatform

import kotlin.test.Test
import kotlin.test.assertEquals

class PlatformRulesTest {
  @Test
  fun exactAlarmsNeedNoGrantBeforeAndroid12() {
    assertEquals("not_required", PlatformRules.exactAlarmState(30, canScheduleExactAlarms = false))
    assertEquals("not_required", PlatformRules.exactAlarmState(24, canScheduleExactAlarms = true))
  }

  @Test
  fun exactAlarmStateFollowsTheSpecialAccessFromAndroid12() {
    assertEquals("granted", PlatformRules.exactAlarmState(31, canScheduleExactAlarms = true))
    assertEquals("denied", PlatformRules.exactAlarmState(34, canScheduleExactAlarms = false))
    assertEquals("denied", PlatformRules.exactAlarmState(36, canScheduleExactAlarms = false))
  }

  @Test
  fun batteryOptimizationWireValues() {
    assertEquals("exempt", PlatformRules.batteryOptimization(true))
    assertEquals("optimized", PlatformRules.batteryOptimization(false))
    assertEquals("unknown", PlatformRules.batteryOptimization(null))
  }

  @Test
  fun exactAlarmHandoffOpensTheAppsSpecialAccessPageFirst() {
    val targets = PlatformRules.exactAlarmTargets(34)
    assertEquals(
      listOf(
        PlatformRules.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
        PlatformRules.ACTION_APPLICATION_DETAILS_SETTINGS,
      ),
      targets.map { it.action },
    )
    assertEquals(listOf(true, true), targets.map { it.packageUri })
    assertEquals(
      listOf(PlatformRules.ACTION_APPLICATION_DETAILS_SETTINGS),
      PlatformRules.exactAlarmTargets(30).map { it.action },
    )
  }

  @Test
  fun batteryHandoffOpensTheSystemListWithoutAnExemptionPrompt() {
    val targets = PlatformRules.batteryTargets()
    assertEquals(PlatformRules.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS, targets.first().action)
    assertEquals(false, targets.first().packageUri)
    assertEquals(
      false,
      targets.any { it.action == "android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" },
    )
  }
}
