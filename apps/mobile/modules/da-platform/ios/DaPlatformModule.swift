import ExpoModulesCore
import UIKit
import UserNotifications

/// `DaPlatform` on iOS (KNOWN_PLATFORM_LIMITATIONS KPL-07): the per-app Time Sensitive
/// notification setting (`UNNotificationSettings.timeSensitiveSetting`, iOS 15+) and the handoff
/// to the app's own notification settings page (`openNotificationSettingsURLString`, iOS 16+).
/// Exact alarms (KPL-09) and battery optimisation (KPL-04) exist only on Android.
public class DaPlatformModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DaPlatform")

    AsyncFunction("getTimeSensitiveSetting") { (promise: Promise) in
      UNUserNotificationCenter.current().getNotificationSettings { settings in
        promise.resolve(Self.wire(settings.timeSensitiveSetting))
      }
    }

    AsyncFunction("openNotificationSettings") { (promise: Promise) in
      guard let url = URL(string: UIApplication.openNotificationSettingsURLString) else {
        promise.resolve(false)
        return
      }
      UIApplication.shared.open(url, options: [:]) { opened in
        promise.resolve(opened)
      }
    }.runOnQueue(.main)
  }

  /// `enabled` / `disabled`; `not_supported` when the app lacks the entitlement or the
  /// notification permission was never decided.
  static func wire(_ setting: UNNotificationSetting) -> String {
    switch setting {
    case .enabled:
      return "enabled"
    case .disabled:
      return "disabled"
    default:
      return "not_supported"
    }
  }
}
