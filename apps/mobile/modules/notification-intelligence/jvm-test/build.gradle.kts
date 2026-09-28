// Compiles only the files of the local modules that import nothing from `android.*` and runs their
// unit tests on the JVM: the notification-intelligence rules and listener health, and the
// da-platform rules. The Android library builds (`../android/build.gradle`,
// `../../da-platform/android/build.gradle`) compile the same files.
plugins {
  kotlin("jvm") version "2.0.21"
}

/** The pure-Kotlin rule files; `scripts/ni-test.sh` fails when one of them imports `android.*`. */
val pureSources =
  listOf("PackageRules.kt", "OtpDetector.kt", "SignalExtractor.kt", "ListenerHealth.kt", "PlatformRules.kt")

sourceSets {
  main {
    kotlin.srcDir("../android/src/main/java")
    kotlin.srcDir("../../da-platform/android/src/main/java")
    kotlin.include(pureSources.map { "**/$it" })
  }
  test {
    kotlin.srcDir("../android/src/test/java")
    kotlin.srcDir("../../da-platform/android/src/test/java")
  }
}

dependencies {
  testImplementation(kotlin("test-junit"))
}

tasks.test {
  useJUnit()
  testLogging {
    events("passed", "failed")
    exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
  }
}
