import SwiftUI
import WidgetKit

/// Dijital Asistan widgets (T-8.25; SCREEN_AND_FLOW_MAP §11). Read-only: a tap opens the related
/// screen, nothing is written from a widget. The extension has no network access; it renders the
/// snapshot the app keeps in the shared App Group.
@main
struct DAWidgetBundle: WidgetBundle {
  var body: some Widget {
    DATodayWidget()
    DALockWidget()
  }
}

struct DATodayWidget: Widget {
  static let kind = "da.today"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: Self.kind, provider: DAProvider()) { entry in
      TodayWidgetView(entry: entry)
    }
    .configurationDisplayName(L10n.t("gallery.name", L10n.deviceLanguage))
    .description(L10n.t("gallery.mediumDescription", L10n.deviceLanguage))
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

struct DALockWidget: Widget {
  static let kind = "da.lock"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: Self.kind, provider: DAProvider()) { entry in
      LockWidgetView(entry: entry)
    }
    .configurationDisplayName(L10n.t("gallery.name", L10n.deviceLanguage))
    .description(L10n.t("gallery.lockDescription", L10n.deviceLanguage))
    .supportedFamilies([.accessoryInline, .accessoryCircular, .accessoryRectangular])
  }
}
