package expo.modules.notificationintelligence

// Pure Kotlin (no android.* imports): compiled and unit-tested on the JVM by `jvm-test/`.

import java.util.Locale

/** Turkish-aware case and accent folding shared by the detectors ("Doğrulama" → "dogrulama"). */
object TextFold {
  private val TURKISH = Locale.forLanguageTag("tr-TR")
  private val FOLD = mapOf('ç' to 'c', 'ğ' to 'g', 'ı' to 'i', 'ö' to 'o', 'ş' to 's', 'ü' to 'u', 'â' to 'a', 'î' to 'i', 'û' to 'u')

  fun fold(value: String): String {
    val lower = value.lowercase(TURKISH)
    val out = StringBuilder(lower.length)
    for (ch in lower) {
      // "İ".lowercase(tr) is "i"; a combining dot left by other locales is dropped.
      if (ch == '̇') continue
      out.append(FOLD[ch] ?: ch)
    }
    return out.toString()
  }
}

/**
 * Verification-code and security detector (M-ANI-01 tests: TR/EN keywords + 4–8 digits). A match
 * drops the whole notification before any extraction; nothing about it is kept.
 */
object OtpDetector {
  /** Keywords that mark a verification or password message on their own. */
  private val STRONG = Regex(
    "dogrulama kod|onay kod|guvenlik kod|giris kod|aktivasyon kod|tek kullanimlik|tek seferlik|" +
      "\\botp\\b|sms sifre|3d secure|3d sifre|sifreniz|sifren\\b|parolaniz|\\bsifre\\b|" +
      "verification code|one-time|one time pass|passcode|security code|login code|sign-in code|" +
      "authentication code|auth code|\\b2fa\\b|two-factor|confirmation code|\\bpin\\b",
  )

  /** Weaker words that count only together with a 4–8 digit code. */
  private val WEAK = Regex("\\bkod[a-z]*\\b|\\bcode[s]?\\b|\\bsifre[a-z]*\\b|\\bparola[a-z]*\\b")

  /** A standalone 4–8 digit code (also `123 456` / `123-456`), not part of an amount or a date. */
  private val CODE = Regex("(?<![\\d.,/:])(\\d{4,8}|\\d{3}[ -]\\d{3})(?![\\d.,/:]?\\d)")

  /** Android 15 replaces sensitive content for untrusted listeners with a placeholder. */
  private val REDACTION = Regex(
    "sensitive notification content hidden|hassas bildirim icerigi gizlendi|icerik gizlendi",
  )

  private val SECURITY_ALERT = Regex(
    "yeni (bir )?cihaz|giris yapildi|oturum acildi|sifre(niz)? degis|parola(niz)? degis|" +
      "supheli|guvenlik uyarisi|new sign-in|new login|signed in|password (was )?changed|" +
      "suspicious|security alert|unusual activity",
  )

  /** [folded] is the output of [TextFold.fold]. */
  fun isOtp(folded: String): Boolean =
    STRONG.containsMatchIn(folded) || (WEAK.containsMatchIn(folded) && CODE.containsMatchIn(folded))

  fun isRedactionPlaceholder(folded: String): Boolean = REDACTION.containsMatchIn(folded)

  /** Sign-in and password alerts are security content: detected and deliberately not extracted. */
  fun isSecurityAlert(folded: String): Boolean = SECURITY_ALERT.containsMatchIn(folded)
}
