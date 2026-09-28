package expo.modules.notificationintelligence

/**
 * Listener health (KNOWN_PLATFORM_LIMITATIONS KPL-04). The system or an OEM battery manager can
 * unbind a granted listener; it then receives nothing although the grant is still on. The facts
 * come from the running process (whether the service is bound right now) and from the timestamps
 * [NiStore] keeps (last connect, last posted notification). Pure Kotlin: no Android imports, so the
 * JVM tests run without the SDK (`scripts/ni-test.sh` enforces it).
 */
data class ListenerFacts(
  val granted: Boolean,
  val enabled: Boolean,
  val connected: Boolean,
  val lastConnectedAt: Long?,
  val lastEventAt: Long?,
)

enum class ListenerHealth(val wire: String) {
  /** The system notification access is off. */
  NOT_GRANTED("not_granted"),

  /** The analysis is off in the app: nothing is expected to arrive. */
  OFF("off"),

  HEALTHY("healthy"),

  /** Granted and on, but the system has not bound (or has unbound) the service. */
  DISCONNECTED("disconnected"),

  /** Bound, but no notification has been observed for [STALE_AFTER_MS]. */
  STALE("stale");

  companion object {
    /** A phone that receives no notification at all for a day is not the normal case. */
    const val STALE_AFTER_MS = 24L * 60 * 60 * 1000

    /** Posted-notification timestamps are written at most once a minute. */
    const val EVENT_WRITE_INTERVAL_MS = 60_000L

    fun evaluate(facts: ListenerFacts, now: Long): ListenerHealth {
      if (!facts.granted) return NOT_GRANTED
      if (!facts.enabled) return OFF
      if (!facts.connected) return DISCONNECTED
      val reference = maxOf(facts.lastEventAt ?: 0L, facts.lastConnectedAt ?: 0L)
      return if (reference > 0L && now - reference > STALE_AFTER_MS) STALE else HEALTHY
    }

    /** Whether a posted notification at [now] should update the stored timestamp. */
    fun shouldRecordEvent(lastEventAt: Long?, now: Long): Boolean =
      lastEventAt == null || now < lastEventAt || now - lastEventAt >= EVENT_WRITE_INTERVAL_MS
  }
}
