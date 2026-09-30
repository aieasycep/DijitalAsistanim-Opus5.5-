import SwiftUI
import WidgetKit

extension View {
  /// iOS 17+ draws the surface as the widget container background (StandBy, tinted and clear
  /// modes); iOS 16 has no content margins, so the view pads itself.
  @ViewBuilder
  func daContainer(_ color: Color) -> some View {
    if #available(iOSApplicationExtension 17.0, *) {
      containerBackground(for: .widget) { color }
    } else {
      padding(14).background(color)
    }
  }

  /// Lock-screen accessories render on the system material; iOS 17 still requires a container.
  @ViewBuilder
  func daAccessoryContainer() -> some View {
    if #available(iOSApplicationExtension 17.0, *) {
      containerBackground(for: .widget) { Color.clear }
    } else {
      self
    }
  }
}

extension DAEntry {
  /// The snapshot when the home families may render it (not signed out, connected, fresh).
  var okSnapshot: WidgetSnapshot? {
    if case .ok(let snapshot) = presence { return snapshot }
    return nil
  }

  /// "Son güncelleme 07:58" once the snapshot is older than 6 h, otherwise `meta`.
  func metaLine(_ meta: String?) -> String? {
    guard isAging, let snapshot else { return meta }
    return L10n.t("staleMeta", lang, ["time": L10n.clock(snapshot.generatedAt)])
  }
}

extension WidgetSnapshot.Priority {
  /// The title the detail level allows on home-screen families (§11.3).
  func title(_ mode: WidgetSnapshot.DetailMode) -> String {
    switch mode {
    case .full: return titleFull ?? titlePrivate ?? ""
    case .titleOnly: return titlePrivate ?? ""
    case .generic: return ""
    }
  }

  func meta(_ mode: WidgetSnapshot.DetailMode) -> String? {
    mode == .full ? (sourceLabel ?? timeLabel) : timeLabel
  }

  /// Critical for `urgent`, warning for `today` and deadlines, neutral otherwise.
  var dotColor: Color {
    if urgency == "urgent" { return WidgetColors.toneCriticalSolid }
    if urgency == "today" || badge == "SON TARİH" { return WidgetColors.toneWarningSolid }
    return WidgetColors.toneNeutralSolid
  }
}

/// `auto_awesome` in the brand colour; accentable in tinted and clear modes (iOS 18).
struct SparkleIcon: View {
  var size: CGFloat = 16

  var body: some View {
    Image(systemName: "sparkles")
      .font(.system(size: size, weight: .semibold))
      .foregroundColor(WidgetColors.brandPrimary)
      .widgetAccentable()
      .accessibilityHidden(true)
  }
}

/// Badge pill: ACİL / GÜVENLİK critical soft, SON TARİH warning soft, the rest neutral.
struct BadgePill: View {
  let badge: String
  let lang: String

  private var colors: (fill: Color, text: Color) {
    switch badge {
    case "ACİL", "GÜVENLİK": return (WidgetColors.toneCriticalSoft, WidgetColors.toneCriticalText)
    case "SON TARİH": return (WidgetColors.toneWarningSoft, WidgetColors.toneWarningText)
    default: return (WidgetColors.toneNeutralSoft, WidgetColors.toneNeutralText)
    }
  }

  var body: some View {
    Text(L10n.badge(badge, lang))
      .font(.system(size: 10, weight: .semibold))
      .foregroundColor(colors.text)
      .lineLimit(1)
      .padding(.horizontal, 6)
      .padding(.vertical, 2)
      .background(Capsule().fill(colors.fill))
  }
}

struct Kicker: View {
  let text: String
  var color: Color = WidgetColors.textAccent

  var body: some View {
    Text(text)
      .font(.system(size: 11, weight: .semibold))
      .foregroundColor(color)
      .lineLimit(1)
  }
}

struct MetaText: View {
  let text: String

  var body: some View {
    Text(text)
      .font(.system(size: 11))
      .foregroundColor(WidgetColors.textTertiaryStrong)
      .lineLimit(1)
  }
}

/// The first-run, signed-out, not-connected and stale states of the home families.
struct StatusView: View {
  let title: String
  let message: String

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      SparkleIcon(size: 18)
      Spacer(minLength: 0)
      Text(title)
        .font(.system(size: 14, weight: .semibold))
        .foregroundColor(WidgetColors.textPrimary)
        .lineLimit(1)
      Text(message)
        .font(.system(size: 12))
        .foregroundColor(WidgetColors.textSecondary)
        .lineLimit(2)
        .minimumScaleFactor(0.8)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }
}

/// Title, message and tap target of a non-`ok` state, or `nil` when the snapshot renders.
func statusContent(_ entry: DAEntry, family: String) -> (title: String, message: String, url: URL?)? {
  let lang = entry.lang
  let name = L10n.t("gallery.name", lang)
  switch entry.presence {
  case .firstRun: return (name, L10n.t("firstRun", lang), Links.today(family))
  case .signedOut: return (name, L10n.t("signIn", lang), Links.today(family))
  case .noSources: return (name, L10n.t("connect", lang), Links.accounts(family))
  case .stale: return (name, L10n.t("staleBody", lang), Links.today(family))
  case .ok: return nil
  }
}

/// "Her şey kontrol altında." with the success check.
struct AllClearView: View {
  let lang: String
  let detail: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Image(systemName: "checkmark.circle.fill")
        .font(.system(size: 18))
        .foregroundColor(WidgetColors.toneSuccessIcon)
        .widgetAccentable()
        .accessibilityHidden(true)
      Spacer(minLength: 0)
      Text(L10n.t("empty", lang))
        .font(.system(size: 14, weight: .semibold))
        .foregroundColor(WidgetColors.textPrimary)
        .lineLimit(2)
      if let detail {
        Text(detail)
          .font(.system(size: 12))
          .foregroundColor(WidgetColors.textSecondary)
          .lineLimit(2)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }
}
