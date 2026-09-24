package expo.modules.notificationintelligence

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PackageRulesTest {
  private val own = "com.dijitalasistan.app"

  @Test
  fun groupsTheBundledDenylist() {
    assertEquals(LockedGroup.AUTHENTICATOR, PackageRules.lockedGroup("com.azure.authenticator", own))
    assertEquals(LockedGroup.PASSWORD_MANAGER, PackageRules.lockedGroup("com.proton.pass", own))
    assertEquals(LockedGroup.E_DEVLET, PackageRules.lockedGroup("tr.gov.turkiye.edevlet.kapisi", own))
    assertEquals(LockedGroup.MESSAGING, PackageRules.lockedGroup("org.telegram.messenger", own))
    assertEquals(LockedGroup.GOOGLE_PLAY_SERVICES, PackageRules.lockedGroup("com.google.android.gms", own))
    assertEquals(LockedGroup.OWN_APP, PackageRules.lockedGroup(own, own))
    assertEquals(LockedGroup.OWN_APP, PackageRules.lockedGroup("$own.dev", own))
  }

  @Test
  fun matchesSecurityAppsByPackageToken() {
    for (pkg in listOf("com.acme.authenticator", "io.otp", "com.dashlane", "net.keepassdroid.keepass", "com.example.passwords")) {
      assertTrue(PackageRules.isLocked(pkg, own), pkg)
    }
    for (pkg in listOf("trendyol.com", "com.pozitron.hepsiburada", "com.hotpepper.app", "com.passport.travel")) {
      assertNull(PackageRules.lockedGroup(pkg, own), pkg)
    }
  }

  @Test
  fun decidesByModeAfterTheDenylist() {
    val allowed = setOf("trendyol.com", "com.whatsapp")
    assertNull(PackageRules.decide("trendyol.com", own, NiMode.SELECTED, allowed))
    assertEquals(DropReason.LOCKED_PACKAGE, PackageRules.decide("com.whatsapp", own, NiMode.SELECTED, allowed))
    assertEquals(DropReason.LOCKED_PACKAGE, PackageRules.decide("com.whatsapp", own, NiMode.ALL, emptySet()))
    assertEquals(DropReason.NOT_SELECTED, PackageRules.decide("com.booking", own, NiMode.SELECTED, allowed))
    assertNull(PackageRules.decide("com.booking", own, NiMode.ALL, emptySet()))
    assertEquals(NiMode.SELECTED, NiMode.of("unknown"))
    assertEquals(NiMode.ALL, NiMode.of("all"))
  }
}
