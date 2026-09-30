package expo.modules.notificationintelligence

// Pure Kotlin (no android.* imports): compiled and unit-tested on the JVM by `jvm-test/`.

/** Access mode of the listener (D-27): `selected` (default) or `all`. */
enum class NiMode(val wire: String) {
  SELECTED("selected"),
  ALL("all");

  companion object {
    fun of(value: String?): NiMode = entries.firstOrNull { it.wire == value } ?: SELECTED
  }
}

/** Groups of the locked denylist, as listed on M-ANI-04. */
enum class LockedGroup(val wire: String) {
  AUTHENTICATOR("authenticator"),
  PASSWORD_MANAGER("password_manager"),
  E_DEVLET("e_devlet"),
  MESSAGING("messaging"),
  GOOGLE_PLAY_SERVICES("google_play_services"),
  OWN_APP("own_app"),
}

/**
 * Package rules (SCREEN_AND_FLOW_MAP §9 "Locked exclusions", C-11). The locked denylist applies in
 * both modes and cannot be changed by the user; in `selected` mode only the allowed packages are
 * read. Security apps are also matched by package-name tokens, so an authenticator or password
 * manager missing from the bundled list is still excluded (fail closed).
 */
object PackageRules {
  /** Bundled defaults; the server additionally rejects the `feature.android_ni` payload denylist. */
  val LOCKED: Map<String, LockedGroup> = linkedMapOf(
    "com.google.android.apps.authenticator2" to LockedGroup.AUTHENTICATOR,
    "com.azure.authenticator" to LockedGroup.AUTHENTICATOR,
    "com.authy.authy" to LockedGroup.AUTHENTICATOR,
    "com.duosecurity.duomobile" to LockedGroup.AUTHENTICATOR,
    "com.okta.android.auth" to LockedGroup.AUTHENTICATOR,
    "com.twofasapp" to LockedGroup.AUTHENTICATOR,
    "com.beemdevelopment.aegis" to LockedGroup.AUTHENTICATOR,
    "com.x8bit.bitwarden" to LockedGroup.PASSWORD_MANAGER,
    "com.agilebits.onepassword" to LockedGroup.PASSWORD_MANAGER,
    "com.lastpass.lpandroid" to LockedGroup.PASSWORD_MANAGER,
    "com.proton.pass" to LockedGroup.PASSWORD_MANAGER,
    "tr.gov.turkiye.edevlet.kapisi" to LockedGroup.E_DEVLET,
    "com.whatsapp" to LockedGroup.MESSAGING,
    "com.whatsapp.w4b" to LockedGroup.MESSAGING,
    "org.telegram.messenger" to LockedGroup.MESSAGING,
    "com.turkcell.bip" to LockedGroup.MESSAGING,
    "com.google.android.apps.messaging" to LockedGroup.MESSAGING,
    "com.samsung.android.messaging" to LockedGroup.MESSAGING,
    "com.android.mms" to LockedGroup.MESSAGING,
    "org.thoughtcrime.securesms" to LockedGroup.MESSAGING,
    "com.facebook.orca" to LockedGroup.MESSAGING,
    "com.google.android.gms" to LockedGroup.GOOGLE_PLAY_SERVICES,
  )

  /** Package-name segments that mark an authenticator or a password manager. */
  private val SECURITY_SEGMENT = Regex(
    "^(authenticator.*|.*authenticator|authy|otp|totp|twofa|2fa|keepass.*|passwords?|" +
      "passwordmanager|bitwarden|onepassword|lastpass.*|dashlane|keeper|enpass)$",
  )

  /** The locked group of a package, or null when the user may choose it. */
  fun lockedGroup(packageName: String, ownPackage: String): LockedGroup? {
    if (packageName == ownPackage || packageName.startsWith("$ownPackage.")) return LockedGroup.OWN_APP
    LOCKED[packageName]?.let { return it }
    val segments = packageName.lowercase().split('.')
    return if (segments.any { SECURITY_SEGMENT.matches(it) }) LockedGroup.AUTHENTICATOR else null
  }

  fun isLocked(packageName: String, ownPackage: String): Boolean =
    lockedGroup(packageName, ownPackage) != null

  /**
   * Whether a notification from [packageName] may be read: null when allowed, else the reason.
   * The denylist wins over both modes.
   */
  fun decide(
    packageName: String,
    ownPackage: String,
    mode: NiMode,
    allowedPackages: Set<String>,
  ): DropReason? = when {
    isLocked(packageName, ownPackage) -> DropReason.LOCKED_PACKAGE
    mode == NiMode.SELECTED && packageName !in allowedPackages -> DropReason.NOT_SELECTED
    else -> null
  }
}
