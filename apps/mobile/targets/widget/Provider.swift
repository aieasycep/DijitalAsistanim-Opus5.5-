import SwiftUI
import WidgetKit

/// One timeline entry: the stored snapshot rendered at `date` (§11.4).
struct DAEntry: TimelineEntry {
  let date: Date
  /// `nil` before the app's first write or when the stored JSON is undecodable (first-run view).
  let snapshot: WidgetSnapshot?

  enum Presence {
    case firstRun
    case signedOut
    case noSources
    case stale
    case ok(WidgetSnapshot)
  }

  /// Staleness is computed at render time from `generated_at`: over 24 h the widget asks the
  /// user to open the app; over 6 h the meta line shows the last update time.
  var presence: Presence {
    guard let snapshot else { return .firstRun }
    switch snapshot.state {
    case .signedOut: return .signedOut
    case .noSources: return .noSources
    case .stale: return .stale
    case .ok:
      return date.timeIntervalSince(snapshot.generatedAt) > DAProvider.staleAfter
        ? .stale : .ok(snapshot)
    }
  }

  var isAging: Bool {
    guard let snapshot else { return false }
    return date.timeIntervalSince(snapshot.generatedAt) > DAProvider.agingAfter
  }

  var lang: String { L10n.language(snapshot) }
}

struct DAProvider: TimelineProvider {
  static let agingAfter: TimeInterval = 6 * 3600
  static let staleAfter: TimeInterval = 24 * 3600
  static let horizon: TimeInterval = 6 * 3600
  static let minimumSpacing: TimeInterval = 5 * 60
  static let maximumReload: TimeInterval = 30 * 60

  func placeholder(in context: Context) -> DAEntry {
    DAEntry(date: Date(), snapshot: SnapshotStore.preview())
  }

  func getSnapshot(in context: Context, completion: @escaping (DAEntry) -> Void) {
    let snapshot = context.isPreview ? SnapshotStore.preview() : SnapshotStore.load()
    completion(DAEntry(date: Date(), snapshot: snapshot))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<DAEntry>) -> Void) {
    let now = Date()
    let snapshot = SnapshotStore.load()
    let dates = Self.entryDates(now: now, snapshot: snapshot)
    let nextBoundary = dates.dropFirst().first ?? now.addingTimeInterval(Self.maximumReload)
    let reload = min(nextBoundary, now.addingTimeInterval(Self.maximumReload))
    completion(
      Timeline(
        entries: dates.map { DAEntry(date: $0, snapshot: snapshot) }, policy: .after(reload)))
  }

  /// `now`, every meeting start and end within 6 h and the staleness boundaries, at least 5 min
  /// apart, so the meeting widgets advance without a new snapshot.
  static func entryDates(now: Date, snapshot: WidgetSnapshot?) -> [Date] {
    guard let snapshot else { return [now] }
    let end = now.addingTimeInterval(horizon)
    let meetings = [snapshot.nextMeeting].compactMap { $0 } + snapshot.laterMeetings
    let boundaries =
      meetings.flatMap { [$0.startAt, $0.endAt] } + [
        snapshot.generatedAt.addingTimeInterval(agingAfter),
        snapshot.generatedAt.addingTimeInterval(staleAfter),
      ]
    var dates = [now]
    for date in boundaries.filter({ $0 > now && $0 <= end }).sorted() {
      if let last = dates.last, date.timeIntervalSince(last) >= minimumSpacing {
        dates.append(date)
      }
    }
    return dates
  }
}
