package expo.modules.notificationintelligence

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ListenerHealthTest {
  private val now = 1_800_000_000_000L
  private val hour = 60L * 60 * 1000

  private fun facts(
    granted: Boolean = true,
    enabled: Boolean = true,
    connected: Boolean = true,
    lastConnectedAt: Long? = now - hour,
    lastEventAt: Long? = now - 5 * 60_000,
  ) = ListenerFacts(granted, enabled, connected, lastConnectedAt, lastEventAt)

  @Test
  fun grantAndSwitchComeFirst() {
    assertEquals(ListenerHealth.NOT_GRANTED, ListenerHealth.evaluate(facts(granted = false), now))
    assertEquals(
      ListenerHealth.NOT_GRANTED,
      ListenerHealth.evaluate(facts(granted = false, connected = false), now),
    )
    assertEquals(ListenerHealth.OFF, ListenerHealth.evaluate(facts(enabled = false), now))
    assertEquals(
      ListenerHealth.OFF,
      ListenerHealth.evaluate(facts(enabled = false, connected = false), now),
    )
  }

  @Test
  fun aGrantedListenerThatIsNotBoundIsDisconnected() {
    assertEquals(ListenerHealth.DISCONNECTED, ListenerHealth.evaluate(facts(connected = false), now))
    assertEquals(
      ListenerHealth.DISCONNECTED,
      ListenerHealth.evaluate(facts(connected = false, lastEventAt = now - 1000), now),
    )
  }

  @Test
  fun aBoundListenerWithRecentActivityIsHealthy() {
    assertEquals(ListenerHealth.HEALTHY, ListenerHealth.evaluate(facts(), now))
    // Just reconnected, nothing posted yet.
    assertEquals(
      ListenerHealth.HEALTHY,
      ListenerHealth.evaluate(facts(lastConnectedAt = now - 60_000, lastEventAt = null), now),
    )
    // Nothing recorded at all (a fresh install right after the grant).
    assertEquals(
      ListenerHealth.HEALTHY,
      ListenerHealth.evaluate(facts(lastConnectedAt = null, lastEventAt = null), now),
    )
  }

  @Test
  fun aBoundListenerThatReceivedNothingForADayIsStale() {
    val stale = facts(lastConnectedAt = now - 30 * hour, lastEventAt = now - 25 * hour)
    assertEquals(ListenerHealth.STALE, ListenerHealth.evaluate(stale, now))
    // The boundary itself is not stale yet.
    val edge = facts(lastConnectedAt = now - 30 * hour, lastEventAt = now - 24 * hour)
    assertEquals(ListenerHealth.HEALTHY, ListenerHealth.evaluate(edge, now))
    // A reconnect restarts the window.
    val rebound = facts(lastConnectedAt = now - hour, lastEventAt = now - 40 * hour)
    assertEquals(ListenerHealth.HEALTHY, ListenerHealth.evaluate(rebound, now))
  }

  @Test
  fun postedTimestampsAreThrottled() {
    assertTrue(ListenerHealth.shouldRecordEvent(null, now))
    assertFalse(ListenerHealth.shouldRecordEvent(now - 30_000, now))
    assertTrue(ListenerHealth.shouldRecordEvent(now - 60_000, now))
    // A clock set back never blocks the write.
    assertTrue(ListenerHealth.shouldRecordEvent(now + 60_000, now))
  }

  @Test
  fun wireValuesMatchTheJsInterface() {
    assertEquals(
      listOf("not_granted", "off", "healthy", "disconnected", "stale"),
      ListenerHealth.entries.map { it.wire },
    )
  }
}
