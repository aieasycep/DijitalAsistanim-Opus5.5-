import ExpoModulesCore
import WidgetKit

/// `DaWidgets` (T-8.25, SCREEN_AND_FLOW_MAP §11.1): writes the zod-validated `WidgetSnapshotV1`
/// JSON to the App Group (`DAAppGroup` in Info.plist, set by the `da-widgets` config plugin) and
/// reloads both widget kinds. The data class of the container is the system default
/// (readable after the first unlock), which the lock-screen families require.
public class DaWidgetsModule: Module {
  static let snapshotKey = "da.widget.snapshot.v1"
  static let schemeKey = "da.widget.scheme"
  static let kinds = ["da.today", "da.lock"]

  public func definition() -> ModuleDefinition {
    Name("DaWidgets")

    AsyncFunction("setSnapshot") { (json: String, scheme: String) in
      guard let defaults = Self.defaults() else { throw AppGroupUnavailableException() }
      defaults.set(json, forKey: Self.snapshotKey)
      defaults.set(scheme, forKey: Self.schemeKey)
      Self.reload()
    }

    AsyncFunction("getSnapshot") { () -> String? in
      Self.defaults()?.string(forKey: Self.snapshotKey)
    }

    AsyncFunction("reload") {
      Self.reload()
    }

    /// `widget_inventory`: a bit per installed family (small 1, medium 2, large 4, inline 8,
    /// circular 16, rectangular 32).
    AsyncFunction("getInventory") { (promise: Promise) in
      WidgetCenter.shared.getCurrentConfigurations { result in
        var families = 0
        if case .success(let infos) = result {
          for info in infos { families |= Self.bit(for: info.family) }
        }
        promise.resolve(["ios_families": families, "android_kinds": 0])
      }
    }
  }

  static func defaults() -> UserDefaults? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "DAAppGroup") as? String,
      !group.isEmpty
    else { return nil }
    return UserDefaults(suiteName: group)
  }

  static func reload() {
    for kind in kinds { WidgetCenter.shared.reloadTimelines(ofKind: kind) }
  }

  static func bit(for family: WidgetFamily) -> Int {
    switch family {
    case .systemSmall: return 1
    case .systemMedium: return 2
    case .systemLarge: return 4
    case .accessoryInline: return 8
    case .accessoryCircular: return 16
    case .accessoryRectangular: return 32
    default: return 0
    }
  }
}

final class AppGroupUnavailableException: Exception {
  override var reason: String {
    "The App Group container is not available (DAAppGroup missing from Info.plist)."
  }
}
