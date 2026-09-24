import Foundation

/// `WidgetSnapshotV1` (packages/validation/src/widget-snapshot.ts). The server already filtered
/// the titles by the notification detail level; fields the level does not allow are absent.
struct WidgetSnapshot: Decodable {
  enum State: String, Decodable {
    case ok
    case signedOut = "signed_out"
    case noSources = "no_sources"
    case stale
  }

  enum DetailMode: String, Decodable {
    case full
    case titleOnly = "title_only"
    case generic
  }

  struct Counts: Decodable {
    let important: Int
    let eventsToday: Int
    let followUps: Int
    let deadlines: Int
  }

  struct Briefing: Decodable {
    let id: String
    let kind: String
    let status: String
    let readyAt: Date?
    let scheduledFor: Date?
    let timeLabel: String?
    let itemCount: Int
    let audioMinutes: Int?
    let deeplink: String
  }

  struct Priority: Decodable {
    let id: String
    let badge: String
    let urgency: String
    let titleFull: String?
    let chipFull: String?
    let titlePrivate: String?
    let timeLabel: String?
    let sourceLabel: String?
    let deeplink: String
  }

  struct Meeting: Decodable {
    let eventId: String
    let startAt: Date
    let endAt: Date
    let timeLabel: String
    let durationMin: Int
    let titleFull: String?
    let titlePrivate: String?
    let prepReady: Bool
    let prepTopicCount: Int?
    let deeplink: String
  }

  struct FollowUp: Decodable {
    let threadId: String
    let insightId: String
    let titleFull: String?
    let titlePrivate: String?
    let waitingDays: Int
    let deeplink: String
  }

  let v: Int
  let etag: String
  let generatedAt: Date
  let locale: String
  let state: State
  let detailMode: DetailMode
  let lockScreenPrivate: Bool
  let entitlement: String
  let counts: Counts
  let briefing: Briefing?
  let priorities: [Priority]
  let nextMeeting: Meeting?
  let laterMeetings: [Meeting]
  let followUp: FollowUp?
  let lastAnalysisAt: Date?

  var isPro: Bool { entitlement == "pro" }

  /// Lock-screen families never show more than `title_only` while `lock_screen_private` is on.
  var lockDetailMode: DetailMode {
    lockScreenPrivate && detailMode == .full ? .titleOnly : detailMode
  }

  /// The meeting that is running or next at `date`; the timeline advances through
  /// `later_meetings` without a new snapshot.
  func meeting(at date: Date) -> Meeting? {
    ([nextMeeting].compactMap { $0 } + laterMeetings).first { $0.endAt > date }
  }

  /// Decodes a stored snapshot; anything undecodable or of another version is `nil`, which the
  /// views render as the first-run state.
  static func decode(_ data: Data) -> WidgetSnapshot? {
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    decoder.dateDecodingStrategy = .custom { decoder in
      let raw = try decoder.singleValueContainer().decode(String.self)
      guard let date = parseDate(raw) else {
        throw DecodingError.dataCorrupted(
          .init(codingPath: decoder.codingPath, debugDescription: "not an ISO date"))
      }
      return date
    }
    guard let snapshot = try? decoder.decode(WidgetSnapshot.self, from: data), snapshot.v == 1
    else { return nil }
    return snapshot
  }

  /// ISO 8601 with an offset; fractional seconds (any precision) are dropped.
  static func parseDate(_ raw: String) -> Date? {
    let trimmed = raw.replacingOccurrences(
      of: "\\.[0-9]+", with: "", options: .regularExpression)
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: trimmed)
  }
}

/// The App Group store the app writes through `DaWidgets.setSnapshot` (§11.1).
enum SnapshotStore {
  static let snapshotKey = "da.widget.snapshot.v1"
  static let schemeKey = "da.widget.scheme"

  /// The containing app's App Group (`DAAppGroup` in its Info.plist, set by the `da-widgets`
  /// config plugin); falls back to `group.<app bundle id>`.
  static var appGroup: String? {
    let hostURL = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent()
    if let group = Bundle(url: hostURL)?.object(forInfoDictionaryKey: "DAAppGroup") as? String,
      !group.isEmpty
    {
      return group
    }
    guard let id = Bundle.main.bundleIdentifier, id.hasSuffix(".widget") else { return nil }
    return "group." + String(id.dropLast(".widget".count))
  }

  private static var defaults: UserDefaults? {
    appGroup.flatMap { UserDefaults(suiteName: $0) }
  }

  static func load() -> WidgetSnapshot? {
    guard let json = defaults?.string(forKey: snapshotKey), let data = json.data(using: .utf8)
    else { return nil }
    return WidgetSnapshot.decode(data)
  }

  /// This build's URL scheme (`dijitalasistan`, `dijitalasistan-dev`, …), written with the snapshot.
  static func scheme() -> String? {
    guard let scheme = defaults?.string(forKey: schemeKey), !scheme.isEmpty else { return nil }
    return scheme
  }

  /// The bundled gallery preview (`golden/preview.json`, PRIMARY demo copy).
  static func preview() -> WidgetSnapshot? {
    let url =
      Bundle.main.url(forResource: "preview", withExtension: "json")
      ?? Bundle.main.url(forResource: "preview", withExtension: "json", subdirectory: "golden")
    guard let url, let data = try? Data(contentsOf: url) else { return nil }
    return WidgetSnapshot.decode(data)
  }
}

/// Widget deep links (§11.5): every URL carries `src=widget&w=<family>` for M-GL-07 analytics.
enum Links {
  static func url(_ deeplink: String?, _ family: String) -> URL? {
    guard let base = deeplink ?? route("today") else { return nil }
    let separator = base.contains("?") ? "&" : "?"
    return URL(string: "\(base)\(separator)src=widget&w=\(family)")
  }

  static func route(_ path: String) -> String? {
    SnapshotStore.scheme().map { "\($0)://\(path)" }
  }

  static func today(_ family: String) -> URL? { url(route("today"), family) }

  static func accounts(_ family: String) -> URL? { url(route("settings/accounts"), family) }

  static func listen(_ briefing: WidgetSnapshot.Briefing, _ family: String) -> URL? {
    url("\(briefing.deeplink)/listen?autoplay=1", family)
  }
}
