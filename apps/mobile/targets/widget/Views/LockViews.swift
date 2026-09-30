import SwiftUI
import WidgetKit

/// `DALockWidget` (M-WGT-04…06). Lock-screen families use the effective level
/// `lock_screen_private ? title_only : full` (§11.3); names are always `.privacySensitive()`.
/// Offline they keep rendering the last snapshot.
struct LockWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: DAEntry

  var body: some View {
    switch family {
    case .accessoryInline: InlineView(entry: entry)
    case .accessoryCircular: CircularView(entry: entry)
    default: RectangularView(entry: entry)
    }
  }
}

// MARK: - M-WGT-04 inline

struct InlineView: View {
  let entry: DAEntry

  private var text: String {
    let lang = entry.lang
    guard let s = entry.snapshot else { return L10n.t("gallery.name", lang) }
    switch s.state {
    case .signedOut: return L10n.t("lock.signedOut", lang)
    case .noSources: return L10n.t("lock.noSources", lang)
    case .ok, .stale:
      let count = s.counts.important
      if count == 0 { return L10n.t("lock.empty", lang) }
      if s.lockDetailMode != .generic, let time = s.priorities.first?.timeLabel {
        return L10n.t("lock.inline", lang, ["count": count, "time": time])
      }
      return L10n.t("generic", lang, ["count": count])
    }
  }

  var body: some View {
    Label {
      Text(text)
    } icon: {
      Image(systemName: "sparkles")
    }
    .widgetURL(entry.snapshot?.state == .noSources ? Links.accounts("inline") : Links.today("inline"))
    .daAccessoryContainer()
  }
}

// MARK: - M-WGT-05 circular

struct CircularView: View {
  let entry: DAEntry

  var body: some View {
    let lang = entry.lang
    ZStack {
      AccessoryWidgetBackground()
      if let s = entry.snapshot {
        if s.state == .signedOut || s.state == .noSources {
          Image(systemName: "sparkles")
            .font(.system(size: 20, weight: .semibold))
            .accessibilityLabel(L10n.t("gallery.name", lang))
        } else if s.counts.important == 0 {
          Image(systemName: "checkmark")
            .font(.system(size: 20, weight: .semibold))
            .widgetAccentable()
            .accessibilityLabel(L10n.t("a11y.noImportant", lang))
        } else {
          VStack(spacing: 0) {
            Text(L10n.upper(L10n.t("lock.important", lang), lang))
              .font(.system(size: 9, weight: .semibold))
              .lineLimit(1)
              .minimumScaleFactor(0.7)
            Text(s.counts.important >= 100 ? "99+" : "\(s.counts.important)")
              .font(.system(size: 20, weight: .semibold))
              .widgetAccentable()
          }
          .accessibilityElement(children: .ignore)
          .accessibilityLabel(L10n.t("generic", lang, ["count": s.counts.important]))
        }
      } else {
        Text("—").font(.system(size: 20, weight: .semibold))
      }
    }
    .widgetURL(entry.snapshot?.state == .noSources ? Links.accounts("circular") : Links.today("circular"))
    .daAccessoryContainer()
  }
}

// MARK: - M-WGT-06 rectangular

struct RectangularView: View {
  let entry: DAEntry
  private let family = "rectangular"

  var body: some View {
    let lang = entry.lang
    let name = L10n.t("gallery.name", lang)
    Group {
      if let s = entry.snapshot {
        switch s.state {
        case .signedOut: lines(name, L10n.t("signIn", lang)).widgetURL(Links.today(family))
        case .noSources: lines(name, L10n.t("connect", lang)).widgetURL(Links.accounts(family))
        case .ok, .stale: content(s)
        }
      } else {
        lines(name, nil).widgetURL(Links.today(family))
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .daAccessoryContainer()
  }

  private func lines(_ first: String, _ second: String?) -> some View {
    VStack(alignment: .leading, spacing: 1) {
      Text(first).font(.system(size: 13, weight: .semibold)).widgetAccentable().lineLimit(1)
      if let second { Text(second).font(.system(size: 13)).lineLimit(1) }
    }
    .accessibilityElement(children: .combine)
  }

  @ViewBuilder
  private func content(_ s: WidgetSnapshot) -> some View {
    let lang = entry.lang
    let mode = s.lockDetailMode
    if let meeting = s.meeting(at: entry.date) {
      let prep = s.isPro && meeting.prepReady
      VStack(alignment: .leading, spacing: 1) {
        Text(L10n.upper(L10n.t("lock.next", lang, ["time": meeting.timeLabel]), lang))
          .font(.system(size: 13, weight: .semibold))
          .widgetAccentable()
          .lineLimit(1)
        switch mode {
        case .full:
          Text(meeting.titleFull ?? L10n.t("private.meeting", lang, ["minutes": meeting.durationMin]))
            .font(.system(size: 13))
            .lineLimit(1)
            .privacySensitive()
        case .titleOnly:
          Text(L10n.t("private.meeting", lang, ["minutes": meeting.durationMin]))
            .font(.system(size: 13))
            .lineLimit(1)
        case .generic:
          Text(L10n.t("lock.meeting", lang)).font(.system(size: 13)).lineLimit(1)
        }
        if prep {
          Text(L10n.t("lock.prepReady", lang)).font(.system(size: 12)).lineLimit(1)
        }
      }
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(
        L10n.t("a11y.nextMeeting", lang, ["time": meeting.timeLabel, "minutes": meeting.durationMin])
          + (prep ? ", " + L10n.t("a11y.prepReady", lang) : ""))
      .widgetURL(Links.url(meeting.deeplink, family))
    } else if s.counts.important > 0 {
      Group {
        if mode == .generic {
          lines(
            L10n.upper(L10n.t("today", lang), lang),
            L10n.t(
              "lock.summary", lang,
              ["count": s.counts.important, "meetings": s.counts.eventsToday]))
        } else {
          lines(
            L10n.upper(L10n.t("lock.importantCount", lang, ["count": s.counts.important]), lang),
            s.priorities.first?.timeLabel.map { L10n.t("lock.first", lang, ["time": $0]) })
        }
      }
      .widgetURL(Links.today(family))
    } else {
      lines(L10n.t("lock.calm", lang), nil).widgetURL(Links.today(family))
    }
  }
}
