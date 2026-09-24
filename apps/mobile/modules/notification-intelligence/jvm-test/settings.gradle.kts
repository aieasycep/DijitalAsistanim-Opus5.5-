// JVM-only build of the pure-Kotlin notification-intelligence rules (no Android SDK needed).
// Run with `pnpm --filter @da/mobile ni:test`.
pluginManagement {
  repositories {
    // Google's Maven Central mirror first: repo.maven.apache.org rate-limits bursts with 429.
    maven("https://maven-central.storage-download.googleapis.com/maven2")
    mavenCentral()
  }
  resolutionStrategy {
    eachPlugin {
      if (requested.id.id == "org.jetbrains.kotlin.jvm") {
        useModule("org.jetbrains.kotlin:kotlin-gradle-plugin:${requested.version}")
      }
    }
  }
}

dependencyResolutionManagement {
  repositories {
    // Google's Maven Central mirror first: repo.maven.apache.org rate-limits bursts with 429.
    maven("https://maven-central.storage-download.googleapis.com/maven2")
    mavenCentral()
  }
}

rootProject.name = "notification-intelligence-rules"
