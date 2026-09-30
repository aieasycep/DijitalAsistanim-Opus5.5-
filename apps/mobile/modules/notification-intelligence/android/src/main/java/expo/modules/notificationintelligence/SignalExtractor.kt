package expo.modules.notificationintelligence

// Pure Kotlin (no android.* imports): compiled and unit-tested on the JVM by `jvm-test/`.

import java.security.MessageDigest
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/** Why a notification produced no signal. Only the reason is ever counted, never the content. */
enum class DropReason {
  DISABLED,
  LOCKED_PACKAGE,
  NOT_SELECTED,
  SECRET,
  CALL,
  MESSAGE,
  ONGOING,
  GROUP_SUMMARY,
  REDACTED,
  OTP,
  SECURITY,
  NO_SIGNAL,
}

/** Server vocabulary of API-ANI-01 `category`. */
enum class SignalCategory(val wire: String) {
  CARGO("cargo"),
  BANK_PAYMENT("bank_payment"),
  FLIGHT("flight"),
  RESERVATION("reservation"),
  OTHER("other"),
}

/** Server vocabulary of API-ANI-01 `tracking_status`. */
enum class TrackingStatus(val wire: String) {
  CREATED("created"),
  IN_TRANSIT("in_transit"),
  OUT_FOR_DELIVERY("out_for_delivery"),
  DELIVERED("delivered"),
  EXCEPTION("exception"),
}

/** `Money` of the API: a decimal string with at most two fraction digits and an ISO currency. */
data class Money(val value: String, val currency: String)

/**
 * What the listener hands to the extractor. The title and text live only in memory for the
 * duration of one call; they are never stored, logged or uploaded (R-15, C-12).
 */
data class NotificationInput(
  val packageName: String,
  val title: String?,
  val text: String?,
  val category: String? = null,
  val visibilitySecret: Boolean = false,
  val ongoing: Boolean = false,
  val groupSummary: Boolean = false,
  val redacted: Boolean = false,
  val postedAtMillis: Long,
)

/** Listener settings the pipeline needs. */
data class NiConfig(
  val enabled: Boolean,
  val mode: NiMode,
  val allowedPackages: Set<String>,
  val ownPackage: String,
)

/**
 * One structured signal (API-ANI-01 `AniSignal`). There is deliberately no title, text or other
 * free-text field: every value is an enum, a number, a date or a bounded code.
 */
data class Signal(
  val signalHash: String,
  val packageName: String,
  val appLabel: String,
  val category: SignalCategory,
  val amount: Money? = null,
  val dueDate: String? = null,
  val trackingStatus: TrackingStatus? = null,
  val flightNo: String? = null,
  val gate: String? = null,
  val postedAt: String,
) {
  /** The upload shape, keyed exactly like the server schema; absent fields are omitted. */
  fun toMap(): Map<String, Any> = buildMap {
    put("signal_hash", signalHash)
    put("package", packageName)
    put("app_label", appLabel)
    put("category", category.wire)
    amount?.let { put("amount", mapOf("value" to it.value, "currency" to it.currency)) }
    dueDate?.let { put("due_date", it) }
    trackingStatus?.let { put("tracking_status", it.wire) }
    flightNo?.let { put("flight_no", it) }
    gate?.let { put("gate", it) }
    put("posted_at", postedAt)
  }

  companion object {
    /** Every key [toMap] can produce (the unit test pins it to the server schema). */
    val WIRE_KEYS = setOf(
      "signal_hash", "package", "app_label", "category", "amount", "due_date",
      "tracking_status", "flight_no", "gate", "posted_at",
    )
  }
}

sealed interface Outcome {
  data class Extracted(val signal: Signal) : Outcome
  data class Dropped(val reason: DropReason) : Outcome
}

/**
 * On-device extraction (SCREEN_AND_FLOW_MAP §9 "Extraction"): package rules, the notification-level
 * exclusions (secret visibility, calls, chat messages, ongoing and group-summary notifications,
 * Android 15 redaction), the OTP and security detectors, then the category rules for shipments,
 * flights, payments and subscriptions, and reservations. A notification that matches none of them
 * produces nothing.
 */
class SignalExtractor(private val zone: TimeZone) {
  fun evaluate(input: NotificationInput, config: NiConfig, appLabel: String): Outcome {
    if (!config.enabled) return Outcome.Dropped(DropReason.DISABLED)
    PackageRules.decide(input.packageName, config.ownPackage, config.mode, config.allowedPackages)
      ?.let { return Outcome.Dropped(it) }
    notificationLevelDrop(input)?.let { return Outcome.Dropped(it) }

    val original = listOfNotNull(input.title, input.text).joinToString("\n")
    val folded = TextFold.fold(original)
    if (OtpDetector.isRedactionPlaceholder(folded)) return Outcome.Dropped(DropReason.REDACTED)
    if (OtpDetector.isOtp(folded)) return Outcome.Dropped(DropReason.OTP)
    if (OtpDetector.isSecurityAlert(folded)) return Outcome.Dropped(DropReason.SECURITY)

    val fields = classify(original, folded, input.postedAtMillis)
      ?: return Outcome.Dropped(DropReason.NO_SIGNAL)
    val postedAt = isoInstant(input.postedAtMillis)
    val label = appLabel.trim().take(60)
    val signal = Signal(
      signalHash = hashOf(input.packageName, fields, utcDay(input.postedAtMillis)),
      packageName = input.packageName,
      appLabel = label,
      category = fields.category,
      amount = fields.amount,
      dueDate = fields.dueDate,
      trackingStatus = fields.trackingStatus,
      flightNo = fields.flightNo,
      gate = fields.gate,
      postedAt = postedAt,
    )
    return Outcome.Extracted(signal)
  }

  private fun notificationLevelDrop(input: NotificationInput): DropReason? = when {
    input.visibilitySecret -> DropReason.SECRET
    input.category == CATEGORY_CALL -> DropReason.CALL
    input.category == CATEGORY_MESSAGE -> DropReason.MESSAGE
    input.ongoing -> DropReason.ONGOING
    input.groupSummary -> DropReason.GROUP_SUMMARY
    input.redacted -> DropReason.REDACTED
    else -> null
  }

  internal data class Fields(
    val category: SignalCategory,
    val amount: Money? = null,
    val dueDate: String? = null,
    val trackingStatus: TrackingStatus? = null,
    val flightNo: String? = null,
    val gate: String? = null,
  )

  private fun classify(original: String, folded: String, postedAt: Long): Fields? {
    if (FLIGHT_CONTEXT.containsMatchIn(folded)) {
      val flightNo = flightNumber(original)
      val gate = gateOf(folded)
      if (flightNo != null || gate != null) {
        return Fields(SignalCategory.FLIGHT, flightNo = flightNo, gate = gate)
      }
    }
    if (CARGO_CONTEXT.containsMatchIn(folded)) {
      trackingStatus(folded)?.let { return Fields(SignalCategory.CARGO, trackingStatus = it) }
    }
    if (PAYMENT_CONTEXT.containsMatchIn(folded) || SUBSCRIPTION_CONTEXT.containsMatchIn(folded)) {
      val amount = amountOf(original)
      val due = dateOf(folded, postedAt)
      if (amount != null || due != null) {
        return Fields(SignalCategory.BANK_PAYMENT, amount = amount, dueDate = due)
      }
    }
    if (RESERVATION_CONTEXT.containsMatchIn(folded)) {
      val due = dateOf(folded, postedAt)
      val amount = amountOf(original)
      if (due != null || amount != null) {
        return Fields(SignalCategory.RESERVATION, amount = amount, dueDate = due)
      }
    }
    return null
  }

  // ─── shipments ─────────────────────────────────────────────────────────────────────────────

  internal fun trackingStatus(folded: String): TrackingStatus? = when {
    CARGO_EXCEPTION.containsMatchIn(folded) -> TrackingStatus.EXCEPTION
    CARGO_HANDED_OVER.containsMatchIn(folded) -> TrackingStatus.IN_TRANSIT
    CARGO_DELIVERED.containsMatchIn(folded) -> TrackingStatus.DELIVERED
    CARGO_OUT.containsMatchIn(folded) -> TrackingStatus.OUT_FOR_DELIVERY
    CARGO_TRANSIT.containsMatchIn(folded) -> TrackingStatus.IN_TRANSIT
    CARGO_CREATED.containsMatchIn(folded) -> TrackingStatus.CREATED
    else -> null
  }

  // ─── flights ───────────────────────────────────────────────────────────────────────────────

  internal fun flightNumber(original: String): String? {
    for (match in FLIGHT_NO.findAll(original)) {
      val code = match.groupValues[1]
      if (code in FLIGHT_STOP) continue
      val candidate = code + match.groupValues[2]
      if (FLIGHT_WIRE.matches(candidate)) return candidate
    }
    return null
  }

  internal fun gateOf(folded: String): String? =
    GATE.find(folded)?.groupValues?.get(1)?.uppercase()?.take(6)

  // ─── amounts ───────────────────────────────────────────────────────────────────────────────

  internal fun amountOf(original: String): Money? {
    for (match in AMOUNT.findAll(original)) {
      val g = match.groupValues
      val (symbol, number) = if (g[1].isNotEmpty()) g[1] to g[2] else g[4] to g[3]
      val currency = currencyOf(symbol) ?: continue
      val value = decimalOf(number) ?: continue
      return Money(value, currency)
    }
    return null
  }

  private fun currencyOf(symbol: String): String? = when (symbol.uppercase()) {
    "₺", "TL", "TRY" -> "TRY"
    "$", "USD" -> "USD"
    "€", "EUR" -> "EUR"
    "£", "GBP" -> "GBP"
    else -> null
  }

  /** `1.250,50` / `1,250.50` / `1250` → `1250.50` / `1250.50` / `1250`. */
  internal fun decimalOf(raw: String): String? {
    val number = raw.replace(" ", "").replace(" ", "")
    val lastDot = number.lastIndexOf('.')
    val lastComma = number.lastIndexOf(',')
    val decimalAt = when {
      lastDot >= 0 && lastComma >= 0 -> maxOf(lastDot, lastComma)
      lastDot >= 0 || lastComma >= 0 -> {
        val at = maxOf(lastDot, lastComma)
        val separator = number[at]
        val fraction = number.length - at - 1
        if (number.count { it == separator } == 1 && fraction in 1..2) at else -1
      }
      else -> -1
    }
    val integer = (if (decimalAt >= 0) number.substring(0, decimalAt) else number).filter { it.isDigit() }
    val fraction = if (decimalAt >= 0) number.substring(decimalAt + 1).filter { it.isDigit() } else ""
    if (integer.isEmpty() || integer.length > 12 || fraction.length > 2) return null
    val trimmed = integer.trimStart('0').ifEmpty { "0" }
    return if (fraction.isEmpty() || fraction.all { it == '0' }) trimmed else "$trimmed.$fraction"
  }

  // ─── dates ─────────────────────────────────────────────────────────────────────────────────

  /** The first date the text names, as `YYYY-MM-DD` in the device zone, or null. */
  internal fun dateOf(folded: String, postedAt: Long): String? {
    NUMERIC_DATE.find(folded)?.let { m ->
      val year = m.groupValues[3].toInt().let { if (it < 100) 2000 + it else it }
      localDate(year, m.groupValues[2].toInt(), m.groupValues[1].toInt())?.let { return it }
    }
    ISO_DATE.find(folded)?.let { m ->
      localDate(m.groupValues[1].toInt(), m.groupValues[2].toInt(), m.groupValues[3].toInt())
        ?.let { return it }
    }
    DAY_MONTH_NAME.find(folded)?.let { m ->
      val month = monthOf(m.groupValues[2])
      val year = m.groupValues[3].toIntOrNull()
      if (month != null) resolve(m.groupValues[1].toInt(), month, year, postedAt)?.let { return it }
    }
    MONTH_NAME_DAY.find(folded)?.let { m ->
      val month = monthOf(m.groupValues[1])
      val year = m.groupValues[3].toIntOrNull()
      if (month != null) resolve(m.groupValues[2].toInt(), month, year, postedAt)?.let { return it }
    }
    KEYWORD_SHORT_DATE.find(folded)?.let { m ->
      resolve(m.groupValues[1].toInt(), m.groupValues[2].toInt(), null, postedAt)?.let { return it }
    }
    SHORT_DATE_KEYWORD.find(folded)?.let { m ->
      resolve(m.groupValues[1].toInt(), m.groupValues[2].toInt(), null, postedAt)?.let { return it }
    }
    return when {
      TOMORROW.containsMatchIn(folded) -> shifted(postedAt, 1)
      TODAY.containsMatchIn(folded) -> shifted(postedAt, 0)
      else -> null
    }
  }

  private fun monthOf(name: String): Int? =
    MONTHS.entries.firstOrNull { (prefix, _) -> name.startsWith(prefix) }?.value

  /** A day and month without a year: the next such date on or after 30 days before posting. */
  private fun resolve(day: Int, month: Int, year: Int?, postedAt: Long): String? {
    if (year != null) return localDate(year, month, day)
    val posted = calendar(postedAt)
    val postedYear = posted.get(Calendar.YEAR)
    val candidate = localDate(postedYear, month, day) ?: return null
    val floor = shifted(postedAt, -30) ?: return candidate
    return if (candidate < floor) localDate(postedYear + 1, month, day) else candidate
  }

  private fun shifted(postedAt: Long, days: Int): String? {
    val cal = calendar(postedAt)
    cal.add(Calendar.DAY_OF_MONTH, days)
    return format(cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH))
  }

  private fun calendar(millis: Long): Calendar =
    Calendar.getInstance(zone).apply { timeInMillis = millis }

  private fun localDate(year: Int, month: Int, day: Int): String? {
    if (year !in 2000..2099 || month !in 1..12 || day < 1) return null
    val cal = Calendar.getInstance(zone).apply {
      clear()
      set(year, month - 1, 1)
    }
    if (day > cal.getActualMaximum(Calendar.DAY_OF_MONTH)) return null
    return format(year, month, day)
  }

  private fun format(year: Int, month: Int, day: Int): String =
    String.format(Locale.ROOT, "%04d-%02d-%02d", year, month, day)

  companion object {
    const val CATEGORY_CALL = "call"
    const val CATEGORY_MESSAGE = "msg"
    /** Bumped when the rules change (the server stores it as `extractor_version`). */
    const val VERSION = "1"

    private val FLIGHT_CONTEXT = Regex(
      "\\bucus|\\bucag|\\bflight|boarding|\\bbinis|\\bkapi\\b|\\bgate\\b|\\bkalkis|\\brotar|\\bsefer|" +
        "havalimani|\\bterminal|departure",
    )
    private val FLIGHT_NO = Regex("(?<![A-Za-z0-9])([A-Z]{2})\\s?(\\d{1,4})(?![0-9])")
    private val FLIGHT_WIRE = Regex("^[A-Z0-9]{2}\\d{1,4}$")
    private val FLIGHT_STOP = setOf("TL", "TR", "NO", "AM", "PM", "KG", "KM", "GB", "MB", "TC")
    /** The first short code within 25 characters after "kapı"/"gate" that is not a clock time. */
    private val GATE = Regex("(?:\\bkapi|\\bgate)[^\\n]{0,25}?\\b([a-z]?\\d{1,3}[a-z]?)\\b(?![:.]\\d)")

    private val CARGO_CONTEXT = Regex(
      "kargo|siparis|gonderi|\\bpaket|teslimat|kurye|shipment|\\bpackage|parcel|\\border\\b|delivery|courier|shipped",
    )
    private val CARGO_EXCEPTION = Regex(
      "teslim edilemedi|teslimat basarisiz|adreste bulunamad|iade edil|gecikme|gecikti|" +
        "delivery failed|could not be delivered|delayed|returned to sender|delivery exception",
    )
    private val CARGO_HANDED_OVER = Regex("kargoya teslim edil|kargoya verildi|kargoya verilmis")
    private val CARGO_DELIVERED = Regex("teslim edildi|teslim edilmis|teslim alindi|\\bdelivered\\b")
    private val CARGO_OUT = Regex("dagitima cikt|dagitimda|out for delivery|kuryeye verildi|kurye yolda|bugun teslim")
    private val CARGO_TRANSIT = Regex(
      "yola cikt|\\byolda\\b|transfer merkez|aktarma|in transit|\\bshipped\\b|on its way|gonderildi|sevk edildi|cikis yapt",
    )
    private val CARGO_CREATED = Regex(
      "siparis(iniz|in)? (alindi|olusturuldu|onaylandi)|hazirlaniyor|order (confirmed|placed|received)|kargo kaydi",
    )

    private val PAYMENT_CONTEXT = Regex(
      "odeme|ekstre|\\bborc|fatura|tahsil|harcama|taksit|kredi karti|kartiniz|hesabiniz|havale|\\beft\\b|" +
        "payment|\\bpaid\\b|charged|\\bbill\\b|statement|\\bdue\\b|invoice|asgari|minimum",
    )
    private val SUBSCRIPTION_CONTEXT = Regex("abonel|uyelig|uyelik|yenilen|subscription|renew|membership")
    private val RESERVATION_CONTEXT = Regex(
      "rezervasyon|reservation|booking|\\bmasa\\b|\\botel|konaklama|etkinlik|\\bbilet|randevu|appointment|check-in",
    )

    private const val CURRENCY = "₺|TL|TRY|\\$|USD|€|EUR|£|GBP"
    private val AMOUNT = Regex(
      "(?:(?<![A-Za-z])($CURRENCY)\\s?(\\d{1,3}(?:[.,\\s]\\d{3})*(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)(?![\\d]))|" +
        "(?:(?<![\\d.,])(\\d{1,3}(?:[.,\\s]\\d{3})*(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)\\s?($CURRENCY)(?![A-Za-z]))",
      RegexOption.IGNORE_CASE,
    )

    private val NUMERIC_DATE = Regex("(?<!\\d)(\\d{1,2})[./-](\\d{1,2})[./-](\\d{4}|\\d{2})(?!\\d)")
    private val ISO_DATE = Regex("(?<!\\d)(\\d{4})-(\\d{2})-(\\d{2})(?!\\d)")
    /** Whole month names (TR, EN) and English abbreviations; never a prefix of another word. */
    private const val MONTH_NAMES =
      "(?:ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik|" +
        "january|february|march|april|may|june|july|august|september|october|november|december|" +
        "jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\\.?(?![a-z])"
    private val DAY_MONTH_NAME = Regex("(?<![\\d.])(\\d{1,2})\\s+($MONTH_NAMES)(?:\\s+(\\d{4}))?")
    private val MONTH_NAME_DAY = Regex("\\b($MONTH_NAMES)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?")
    private val KEYWORD_SHORT_DATE = Regex(
      "(?:tarih[a-z]*|son odeme|vade[a-z]*|\\bdue(?: on| by)?|until)\\s*:?\\s*(\\d{1,2})[./](\\d{1,2})(?![./]?\\d)",
    )
    private val SHORT_DATE_KEYWORD = Regex("(?<![\\d.])(\\d{1,2})[./](\\d{1,2})(?![./]?\\d)\\s*(?:tarih|'?[aey]e? kadar)")
    private val TOMORROW = Regex("\\byarin\\b|\\btomorrow\\b")
    private val TODAY = Regex("\\bbugun\\b|\\btoday\\b")

    private val MONTHS: Map<String, Int> = linkedMapOf(
      "ocak" to 1, "subat" to 2, "mart" to 3, "nisan" to 4, "mayis" to 5, "haziran" to 6,
      "temmuz" to 7, "agustos" to 8, "eylul" to 9, "ekim" to 10, "kasim" to 11, "aralik" to 12,
      "jan" to 1, "feb" to 2, "mar" to 3, "apr" to 4, "may" to 5, "jun" to 6,
      "jul" to 7, "aug" to 8, "sep" to 9, "oct" to 10, "nov" to 11, "dec" to 12,
    )

    /** ISO-8601 UTC instant with milliseconds (`IsoDateTime`). */
    fun isoInstant(millis: Long): String {
      val cal = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply { timeInMillis = millis }
      return String.format(
        Locale.ROOT,
        "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",
        cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH),
        cal.get(Calendar.HOUR_OF_DAY), cal.get(Calendar.MINUTE), cal.get(Calendar.SECOND),
        cal.get(Calendar.MILLISECOND),
      )
    }

    private fun utcDay(millis: Long): String = isoInstant(millis).substring(0, 10)

    /**
     * The idempotency hash (`signal_hash`): the package, the extracted fields and the UTC day, so a
     * re-posted notification with the same facts maps to the same signal and a changed status to a
     * new one. The text itself never enters the hash input.
     */
    internal fun hashOf(packageName: String, fields: Fields, day: String): String {
      val input = listOf(
        "v$VERSION", packageName, fields.category.wire, fields.amount?.value.orEmpty(),
        fields.amount?.currency.orEmpty(), fields.dueDate.orEmpty(), fields.trackingStatus?.wire.orEmpty(),
        fields.flightNo.orEmpty(), fields.gate.orEmpty(), day,
      ).joinToString("|")
      val digest = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
      return digest.joinToString("") { String.format(Locale.ROOT, "%02x", it) }
    }
  }
}
