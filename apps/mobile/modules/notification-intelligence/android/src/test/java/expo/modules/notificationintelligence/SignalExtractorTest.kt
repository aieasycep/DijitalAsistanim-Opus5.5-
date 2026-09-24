package expo.modules.notificationintelligence

import java.lang.reflect.Modifier
import java.util.TimeZone
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Extraction rules (M-ANI-01 / M-ON-14A tests): OTP and security content is dropped, the denylist
 * wins over "all" mode, unselected packages produce nothing in "selected" mode, and a signal has
 * no raw-text field.
 */
class SignalExtractorTest {
  private val zone = TimeZone.getTimeZone("Europe/Istanbul")
  private val extractor = SignalExtractor(zone)
  private val own = "com.dijitalasistan.app"

  /** 2026-09-24T09:30:00Z (12:30 in Istanbul). */
  private val posted = 1_790_242_200_000L

  private val all = NiConfig(enabled = true, mode = NiMode.ALL, allowedPackages = emptySet(), ownPackage = own)

  private fun input(pkg: String, title: String?, text: String?, category: String? = null) =
    NotificationInput(packageName = pkg, title = title, text = text, category = category, postedAtMillis = posted)

  private fun extract(pkg: String, title: String?, text: String?, config: NiConfig = all): Signal {
    val outcome = extractor.evaluate(input(pkg, title, text), config, "App")
    assertIs<Outcome.Extracted>(outcome, "expected a signal, got $outcome")
    return outcome.signal
  }

  private fun dropped(pkg: String, title: String?, text: String?, config: NiConfig = all): DropReason {
    val outcome = extractor.evaluate(input(pkg, title, text), config, "App")
    assertIs<Outcome.Dropped>(outcome, "expected a drop, got $outcome")
    return outcome.reason
  }

  @Test
  fun dropsTurkishAndEnglishVerificationCodes() {
    val vectors = listOf(
      "Doğrulama kodunuz: 482913. Kimseyle paylaşmayın.",
      "GARANTI BBVA: 3D Secure şifreniz 551209",
      "İşlem onay kodu 7781",
      "Your verification code is 552 019",
      "Use 918273 as your one-time password",
      "Giriş kodun 4402",
      "123456 is your code",
      "OTP: 99887766",
    )
    for (text in vectors) assertEquals(DropReason.OTP, dropped("com.example.bank", null, text), text)
  }

  @Test
  fun keepsCodesThatAreNotVerificationCodes() {
    val signal = extract("trendyol.com", "Siparişin yola çıktı", "Kargo takip no 1234567890123")
    assertEquals(TrackingStatus.IN_TRANSIT, signal.trackingStatus)
  }

  @Test
  fun dropsSecurityAlertsAndRedactedContent() {
    assertEquals(DropReason.SECURITY, dropped("com.example.shop", "Güvenlik uyarısı", "Hesabına yeni bir cihazdan giriş yapıldı"))
    assertEquals(DropReason.SECURITY, dropped("com.example.shop", null, "New sign-in to your account"))
    assertEquals(DropReason.REDACTED, dropped("com.example.bank", "Banka", "Sensitive notification content hidden"))
    val redacted = extractor.evaluate(input("com.example.bank", "Banka", "…").copy(redacted = true), all, "App")
    assertEquals(Outcome.Dropped(DropReason.REDACTED), redacted)
  }

  @Test
  fun dropsSecretCallMessageOngoingAndSummaryNotifications() {
    val base = input("com.example.shop", "Siparişin teslim edildi", "Kargo teslim edildi")
    assertEquals(Outcome.Dropped(DropReason.SECRET), extractor.evaluate(base.copy(visibilitySecret = true), all, "A"))
    assertEquals(Outcome.Dropped(DropReason.CALL), extractor.evaluate(base.copy(category = "call"), all, "A"))
    assertEquals(Outcome.Dropped(DropReason.MESSAGE), extractor.evaluate(base.copy(category = "msg"), all, "A"))
    assertEquals(Outcome.Dropped(DropReason.ONGOING), extractor.evaluate(base.copy(ongoing = true), all, "A"))
    assertEquals(Outcome.Dropped(DropReason.GROUP_SUMMARY), extractor.evaluate(base.copy(groupSummary = true), all, "A"))
  }

  @Test
  fun denylistWinsOverAllMode() {
    val text = "Kargonuz teslim edildi"
    for (pkg in listOf("com.whatsapp", "com.google.android.apps.authenticator2", "tr.gov.turkiye.edevlet.kapisi", "com.x8bit.bitwarden", own, "com.acme.authenticator", "org.keepassdx.keepass")) {
      assertEquals(DropReason.LOCKED_PACKAGE, dropped(pkg, "Kargo", text), pkg)
    }
  }

  @Test
  fun unselectedPackageProducesNothingInSelectedMode() {
    val selected = all.copy(mode = NiMode.SELECTED, allowedPackages = setOf("trendyol.com"))
    assertEquals(DropReason.NOT_SELECTED, dropped("com.pozitron.hepsiburada", "Kargo", "Kargonuz teslim edildi", selected))
    assertEquals(TrackingStatus.DELIVERED, extract("trendyol.com", "Kargo", "Kargonuz teslim edildi", selected).trackingStatus)
    assertEquals(DropReason.DISABLED, dropped("trendyol.com", "Kargo", "Kargonuz teslim edildi", selected.copy(enabled = false)))
  }

  @Test
  fun extractsShipmentStatuses() {
    val cases = mapOf(
      "Siparişiniz alındı, hazırlanıyor" to TrackingStatus.CREATED,
      "Siparişin kargoya teslim edildi" to TrackingStatus.IN_TRANSIT,
      "Kargon transfer merkezinde" to TrackingStatus.IN_TRANSIT,
      "Paketiniz dağıtıma çıktı" to TrackingStatus.OUT_FOR_DELIVERY,
      "Kargonuz teslim edildi" to TrackingStatus.DELIVERED,
      "Gönderiniz teslim edilemedi, adreste bulunamadınız" to TrackingStatus.EXCEPTION,
      "Your package is out for delivery" to TrackingStatus.OUT_FOR_DELIVERY,
      "Your order has been delivered" to TrackingStatus.DELIVERED,
    )
    for ((text, status) in cases) {
      val signal = extract("com.yurticikargo.mobil", null, text)
      assertEquals(SignalCategory.CARGO, signal.category, text)
      assertEquals(status, signal.trackingStatus, text)
    }
  }

  @Test
  fun extractsFlightNumberAndGate() {
    val signal = extract("com.turkishairlines.mobile", "TK1985 kapı değişikliği", "Uçuşunuz için yeni kapı B14")
    assertEquals(SignalCategory.FLIGHT, signal.category)
    assertEquals("TK1985", signal.flightNo)
    assertEquals("B14", signal.gate)
    val english = extract("com.pozitron.pegasus", "Flight PC 2014", "Boarding at gate 212 closes at 14:30")
    assertEquals("PC2014", english.flightNo)
    assertEquals("212", english.gate)
  }

  @Test
  fun extractsPaymentsAndSubscriptions() {
    val bill = extract("com.garanti.cepsubesi", "Ekstre", "Kredi kartı ekstre borcunuz 1.250,50 TL, son ödeme tarihi 15.10.2026")
    assertEquals(SignalCategory.BANK_PAYMENT, bill.category)
    assertEquals(Money("1250.50", "TRY"), bill.amount)
    assertEquals("2026-10-15", bill.dueDate)

    val short = extract("com.akbank.android.apps.akbank_direkt", null, "Son ödeme tarihi 05.10 · asgari ₺300")
    assertEquals(Money("300", "TRY"), short.amount)
    assertEquals("2026-10-05", short.dueDate)

    val renewal = extract("com.spotify.music", "Premium", "Aboneliğin 3 Ekim'de 59,99 TL ile yenilenecek")
    assertEquals(SignalCategory.BANK_PAYMENT, renewal.category)
    assertEquals(Money("59.99", "TRY"), renewal.amount)
    assertEquals("2026-10-03", renewal.dueDate)

    val english = extract("com.example.bank", "Payment due", "Your bill of $1,249.00 is due on Oct 2")
    assertEquals(Money("1249", "USD"), english.amount)
    assertEquals("2026-10-02", english.dueDate)

    // A day and month earlier in the year than the post (beyond 30 days) resolves to next year.
    val nextYear = extract("com.example.bank", null, "Son ödeme tarihi 10 Ocak, tutar 500 TL")
    assertEquals("2027-01-10", nextYear.dueDate)
  }

  @Test
  fun extractsReservations() {
    val signal = extract("com.booking", "Rezervasyon onaylandı", "Otel konaklaman 12 Kasım 2026 tarihinde başlıyor")
    assertEquals(SignalCategory.RESERVATION, signal.category)
    assertEquals("2026-11-12", signal.dueDate)
  }

  @Test
  fun ignoresNotificationsWithoutStructuredFacts() {
    assertEquals(DropReason.NO_SIGNAL, dropped("com.example.news", "Gündem", "Bugünün öne çıkan haberleri"))
    assertEquals(DropReason.NO_SIGNAL, dropped("com.example.shop", "Kampanya", "Sepetindeki ürünler seni bekliyor"))
  }

  @Test
  fun signalHasNoRawTextFields() {
    val title = "Siparişin yola çıktı"
    val text = "Kargo takip no 1234567890123, Ayşe Yılmaz adresine"
    val signal = extract("trendyol.com", title, text)
    val map = signal.toMap()
    assertTrue(Signal.WIRE_KEYS.containsAll(map.keys))
    assertFalse(map.keys.any { it in setOf("title", "text", "body", "content", "message") })
    for (value in map.values) {
      assertNotEquals(title, value)
      assertNotEquals(text, value)
      assertFalse(value.toString().contains("Ayşe"))
    }
    val fields = Signal::class.java.declaredFields
      .filterNot { Modifier.isStatic(it.modifiers) }
      .map { it.name }
      .toSet()
    assertEquals(
      setOf("signalHash", "packageName", "appLabel", "category", "amount", "dueDate", "trackingStatus", "flightNo", "gate", "postedAt"),
      fields,
    )
  }

  @Test
  fun signalHashIsStableAndFieldSensitive() {
    val first = extract("trendyol.com", null, "Kargon yola çıktı")
    val again = extract("trendyol.com", "Güncelleme", "Siparişin yolda")
    val delivered = extract("trendyol.com", null, "Kargon teslim edildi")
    assertEquals(first.signalHash, again.signalHash)
    assertNotEquals(first.signalHash, delivered.signalHash)
    assertTrue(Regex("^[a-f0-9]{64}$").matches(first.signalHash))
    assertEquals("2026-09-24T09:30:00.000Z", first.postedAt)
  }

  @Test
  fun parsesAmountFormats() {
    assertEquals("1250.5", extractor.decimalOf("1.250,5"))
    assertEquals("1250.50", extractor.decimalOf("1,250.50"))
    assertEquals("1250", extractor.decimalOf("1.250"))
    assertEquals("12", extractor.decimalOf("12,00"))
    assertNull(extractor.decimalOf("1234567890123"))
  }

  @Test
  fun appLabelIsBounded() {
    val outcome = extractor.evaluate(input("trendyol.com", null, "Kargon teslim edildi"), all, "x".repeat(90))
    assertIs<Outcome.Extracted>(outcome)
    assertEquals(60, outcome.signal.appLabel.length)
  }
}
