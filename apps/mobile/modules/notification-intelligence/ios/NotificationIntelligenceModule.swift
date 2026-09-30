import ExpoModulesCore

/// iOS has no notification listener API: the stub reports the feature as unavailable and the app
/// hides every Android Notification Intelligence entry point (REQ-ANDNI-06).
public class NotificationIntelligenceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NotificationIntelligence")

    Function("isAvailable") {
      return false
    }
  }
}
