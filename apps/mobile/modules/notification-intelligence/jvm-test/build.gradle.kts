// Compiles only the files of the module that import nothing from `android.*` and runs their unit
// tests on the JVM. The Android library build (`../android/build.gradle`) compiles the same files.
plugins {
  kotlin("jvm") version "2.0.21"
}

/** The pure-Kotlin rule files; `scripts/ni-test.sh` fails when one of them imports `android.*`. */
val pureSources = listOf("PackageRules.kt", "OtpDetector.kt", "SignalExtractor.kt")

sourceSets {
  main {
    kotlin.srcDir("../android/src/main/java")
    kotlin.include(pureSources.map { "**/$it" })
  }
  test {
    kotlin.srcDir("../android/src/test/java")
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
