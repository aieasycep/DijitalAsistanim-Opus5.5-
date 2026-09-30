import SwiftUI
import WidgetKit

/// `DATodayWidget` (M-WGT-01…03): small, medium and large home-screen families.
struct TodayWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: DAEntry

  var body: some View {
    switch family {
    case .systemMedium: MediumView(entry: entry)
    case .systemLarge: LargeView(entry: entry)
    default: SmallView(entry: entry)
    }
  }
}

// MARK: - M-WGT-01 small · Sıradaki

struct SmallView: View {
  let entry: DAEntry
  private let family = "small"

  var body: some View {
    Group {
      if let status = statusContent(entry, family: family) {
        StatusView(title: status.title, message: status.message).widgetURL(status.url)
      } else if let snapshot = entry.okSnapshot {
        content(snapshot)
      }
    }
    .daContainer(WidgetColors.surface)
  }

  @ViewBuilder
  private func content(_ s: WidgetSnapshot) -> some View {
    let lang = entry.lang
    if s.detailMode == .generic {
      VStack(alignment: .leading, spacing: 4) {
        SparkleIcon()
        Spacer(minLength: 0)
        Kicker(text: L10n.upper(L10n.t("today", lang), lang))
        Text(L10n.t("generic", lang, ["count": s.counts.important]))
          .font(.system(size: 14, weight: .semibold))
          .foregroundColor(WidgetColors.textPrimary)
          .lineLimit(2)
          .minimumScaleFactor(0.8)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      .accessibilityElement(children: .combine)
      .widgetURL(Links.today(family))
    } else if let priority = s.priorities.first {
      VStack(alignment: .leading, spacing: 0) {
        HStack(spacing: 6) {
          SparkleIcon()
          BadgePill(badge: priority.badge, lang: lang)
          Spacer(minLength: 0)
        }
        Spacer(minLength: 6)
        Text(priority.title(s.detailMode))
          .font(.system(size: 14, weight: .semibold))
          .foregroundColor(WidgetColors.textPrimary)
          .lineLimit(2)
          .minimumScaleFactor(0.8)
          .privacySensitive(s.detailMode == .full)
        if let meta = entry.metaLine(priority.meta(s.detailMode)) {
          MetaText(text: meta).padding(.top, 4)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      .accessibilityElement(children: .combine)
      .widgetURL(Links.url(priority.deeplink, family))
    } else {
      AllClearView(
        lang: lang,
        detail: entry.metaLine(
          s.lastAnalysisAt.map { L10n.t("lastAnalysis", lang, ["time": L10n.clock($0)]) })
      )
      .widgetURL(Links.today(family))
    }
  }
}

// MARK: - M-WGT-02 medium · Bugünün 3 önceliği

struct MediumView: View {
  let entry: DAEntry
  private let family = "medium"

  var body: some View {
    Group {
      if let status = statusContent(entry, family: family) {
        StatusView(title: status.title, message: status.message).widgetURL(status.url)
      } else if let snapshot = entry.okSnapshot {
        content(snapshot).widgetURL(Links.today(family))
      }
    }
    .daContainer(WidgetColors.surface)
  }

  private func content(_ s: WidgetSnapshot) -> some View {
    let lang = entry.lang
    let updated = L10n.clock(s.generatedAt)
    return VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 6) {
        SparkleIcon(size: 14)
        Kicker(text: L10n.upper(L10n.t("medium.kicker", lang, ["count": s.counts.important]), lang))
        Spacer(minLength: 4)
        MetaText(text: entry.metaLine(updated) ?? updated)
      }
      if s.detailMode == .generic {
        HStack(spacing: 8) {
          CountTile(label: L10n.t("counts.important", lang), value: s.counts.important)
          CountTile(label: L10n.t("counts.meetings", lang), value: s.counts.eventsToday)
          CountTile(label: L10n.t("counts.followUps", lang), value: s.counts.followUps)
        }
      } else if s.priorities.isEmpty {
        Text(L10n.t("empty", lang))
          .font(.system(size: 14, weight: .semibold))
          .foregroundColor(WidgetColors.textPrimary)
        Text(L10n.t("medium.emptyBody", lang))
          .font(.system(size: 12))
          .foregroundColor(WidgetColors.textSecondary)
          .lineLimit(2)
      } else {
        ForEach(Array(s.priorities.prefix(3)), id: \.id) { priority in
          if let url = Links.url(priority.deeplink, family) {
            Link(destination: url) { PriorityRow(priority: priority, mode: s.detailMode, lang: lang) }
          } else {
            PriorityRow(priority: priority, mode: s.detailMode, lang: lang)
          }
        }
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct PriorityRow: View {
  let priority: WidgetSnapshot.Priority
  let mode: WidgetSnapshot.DetailMode
  let lang: String

  var body: some View {
    let title = priority.title(mode)
    let time = priority.timeLabel ?? ""
    HStack(spacing: 8) {
      Circle().fill(priority.dotColor).frame(width: 6, height: 6)
      Text(title)
        .font(.system(size: 13, weight: .medium))
        .foregroundColor(WidgetColors.textPrimary)
        .lineLimit(1)
        .privacySensitive(mode == .full)
      Spacer(minLength: 4)
      if !time.isEmpty { MetaText(text: time) }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(
      [L10n.badge(priority.badge, lang), title, time].filter { !$0.isEmpty }.joined(separator: ", "))
  }
}

struct CountTile: View {
  let label: String
  let value: Int

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text("\(value)")
        .font(.system(size: 20, weight: .semibold))
        .foregroundColor(WidgetColors.textPrimary)
      Text(label)
        .font(.system(size: 11))
        .foregroundColor(WidgetColors.textSecondary)
        .lineLimit(1)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(8)
    .background(RoundedRectangle(cornerRadius: 10).fill(WidgetColors.surfaceSunken))
    .accessibilityElement(children: .combine)
  }
}

// MARK: - M-WGT-03 large · Brifing + sonraki toplantı + takip

struct LargeView: View {
  let entry: DAEntry
  private let family = "large"

  var body: some View {
    Group {
      if let status = statusContent(entry, family: family) {
        StatusView(title: status.title, message: status.message).widgetURL(status.url)
      } else if let snapshot = entry.okSnapshot {
        if isEmpty(snapshot) {
          AllClearView(lang: entry.lang, detail: nil).widgetURL(Links.today(family))
        } else {
          VStack(alignment: .leading, spacing: 12) {
            briefingCard(snapshot)
            meetingSection(snapshot)
            followUpSection(snapshot)
            Spacer(minLength: 0)
          }
          .widgetURL(Links.today(family))
        }
      }
    }
    .daContainer(WidgetColors.surface)
  }

  private func isEmpty(_ s: WidgetSnapshot) -> Bool {
    s.briefing == nil && s.meeting(at: entry.date) == nil && s.followUp == nil
      && s.counts.important == 0 && s.counts.followUps == 0
  }

  private func briefingKicker(_ kind: String?) -> String {
    switch kind {
    case "midday": return "large.briefingMidday"
    case "evening": return "large.briefingEvening"
    default: return "large.briefing"
    }
  }

  /// "Bugün bilmen gereken **5** şey var." with the number in the brand colour.
  private func countLine(_ text: String, _ count: Int) -> Text {
    let number = "\(count)"
    guard let range = text.range(of: number) else { return Text(text) }
    return Text(String(text[..<range.lowerBound]))
      + Text(number).foregroundColor(WidgetColors.brandPrimary)
      + Text(String(text[range.upperBound...]))
  }

  private func briefingLine(_ s: WidgetSnapshot) -> Text {
    let lang = entry.lang
    guard let briefing = s.briefing else {
      return Text(L10n.t("generic", lang, ["count": s.counts.important]))
    }
    switch briefing.status {
    case "generating": return Text(L10n.upper(L10n.t("large.generating", lang), lang))
    case "scheduled":
      return Text(L10n.t("large.scheduled", lang, ["time": briefing.timeLabel ?? ""]))
    default:
      return countLine(
        L10n.t("large.briefingCount", lang, ["count": briefing.itemCount]), briefing.itemCount)
    }
  }

  @ViewBuilder
  private func briefingCard(_ s: WidgetSnapshot) -> some View {
    let lang = entry.lang
    let header = VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 6) {
        SparkleIcon(size: 14)
        Kicker(text: L10n.upper(L10n.t(briefingKicker(s.briefing?.kind), lang), lang))
        Spacer(minLength: 0)
      }
      briefingLine(s)
        .font(.system(size: 16, weight: .semibold))
        .foregroundColor(WidgetColors.textPrimary)
        .lineLimit(2)
        .minimumScaleFactor(0.8)
    }
    VStack(alignment: .leading, spacing: 8) {
      if let url = Links.url(s.briefing?.deeplink, family) {
        Link(destination: url) { header }
      } else {
        header
      }
      if s.isPro, let briefing = s.briefing, briefing.status == "ready",
        let minutes = briefing.audioMinutes, let url = Links.listen(briefing, family)
      {
        Link(destination: url) {
          Label(L10n.t("large.listen", lang, ["minutes": minutes]), systemImage: "play.fill")
            .font(.system(size: 12, weight: .semibold))
            .foregroundColor(WidgetColors.brandOnSoft)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(WidgetColors.brandSoft))
        }
        .accessibilityLabel(L10n.t("a11y.listen", lang, ["minutes": minutes]))
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      RoundedRectangle(cornerRadius: 16).fill(
        LinearGradient(
          colors: [WidgetColors.aiGlowFrom, WidgetColors.aiGlowTo], startPoint: .topLeading,
          endPoint: .bottomTrailing)))
  }

  private func meetingTitle(_ m: WidgetSnapshot.Meeting, _ s: WidgetSnapshot) -> String {
    let lang = entry.lang
    let privateTitle = L10n.t("private.meeting", lang, ["minutes": m.durationMin])
    switch s.detailMode {
    case .full: return m.titleFull ?? m.titlePrivate ?? privateTitle
    case .titleOnly: return privateTitle
    case .generic: return L10n.t("large.meetingCount", lang, ["count": s.counts.eventsToday])
    }
  }

  @ViewBuilder
  private func meetingSection(_ s: WidgetSnapshot) -> some View {
    let lang = entry.lang
    let meeting = s.meeting(at: entry.date)
    let row = HStack(spacing: 10) {
      if let meeting, s.detailMode != .generic { TimeTile(label: meeting.timeLabel) }
      VStack(alignment: .leading, spacing: 2) {
        Kicker(
          text: L10n.upper(L10n.t("large.nextMeeting", lang), lang),
          color: WidgetColors.textTertiaryStrong)
        if let meeting {
          Text(meetingTitle(meeting, s))
            .font(.system(size: 13, weight: .semibold))
            .foregroundColor(WidgetColors.textPrimary)
            .lineLimit(1)
            .privacySensitive(s.detailMode == .full)
          if s.isPro, meeting.prepReady {
            Text(L10n.t("large.prepReady", lang, ["count": meeting.prepTopicCount ?? 0]))
              .font(.system(size: 11, weight: .medium))
              .foregroundColor(WidgetColors.toneSuccessText)
          }
        } else {
          Text(L10n.t("large.noMeeting", lang))
            .font(.system(size: 13))
            .foregroundColor(WidgetColors.textSecondary)
        }
      }
      Spacer(minLength: 0)
    }
    if let meeting, let url = Links.url(meeting.deeplink, family) {
      Link(destination: url) { row }
    } else {
      row
    }
  }

  @ViewBuilder
  private func followUpSection(_ s: WidgetSnapshot) -> some View {
    let lang = entry.lang
    let full = s.detailMode == .full
    let row = HStack(alignment: .top, spacing: 10) {
      Image(systemName: "arrowshape.turn.up.right.fill")
        .font(.system(size: 14))
        .foregroundColor(WidgetColors.iconDefault)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 2) {
        Kicker(
          text: L10n.upper(L10n.t("large.followUp", lang), lang),
          color: WidgetColors.textTertiaryStrong)
        if s.detailMode == .generic {
          Text(
            s.counts.followUps == 0
              ? L10n.t("large.noFollowUp", lang)
              : L10n.t("large.openFollowUps", lang, ["count": s.counts.followUps])
          )
          .font(.system(size: 13, weight: .semibold))
          .foregroundColor(WidgetColors.textPrimary)
        } else if let followUp = s.followUp {
          Text(
            full
              ? (followUp.titleFull ?? L10n.t("large.followUpPrivate", lang))
              : L10n.t("large.followUpPrivate", lang)
          )
          .font(.system(size: 13, weight: .semibold))
          .foregroundColor(WidgetColors.textPrimary)
          .lineLimit(1)
          .privacySensitive(full)
          MetaText(text: L10n.t("large.noReplyDays", lang, ["count": followUp.waitingDays]))
        } else {
          Text(L10n.t("large.noFollowUp", lang))
            .font(.system(size: 13))
            .foregroundColor(WidgetColors.textSecondary)
        }
      }
      Spacer(minLength: 0)
      if full, s.followUp != nil {
        Text(L10n.t("large.followUpAction", lang))
          .font(.system(size: 12, weight: .semibold))
          .foregroundColor(WidgetColors.brandOnSoft)
          .padding(.horizontal, 10)
          .padding(.vertical, 5)
          .background(Capsule().fill(WidgetColors.brandSoft))
      }
    }
    if let followUp = s.followUp, let url = Links.url(followUp.deeplink, family) {
      Link(destination: url) { row }
    } else {
      row
    }
  }
}

/// "14" over "30"; read as "14:30".
struct TimeTile: View {
  let label: String

  var body: some View {
    let parts = label.split(separator: ":").map(String.init)
    VStack(spacing: 0) {
      Text(parts.first ?? label)
        .font(.system(size: 16, weight: .semibold))
        .foregroundColor(WidgetColors.textPrimary)
      if parts.count > 1 {
        Text(parts[1])
          .font(.system(size: 11, weight: .medium))
          .foregroundColor(WidgetColors.textSecondary)
      }
    }
    .frame(width: 40, height: 40)
    .background(RoundedRectangle(cornerRadius: 10).fill(WidgetColors.surfaceSunken))
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(label)
  }
}
