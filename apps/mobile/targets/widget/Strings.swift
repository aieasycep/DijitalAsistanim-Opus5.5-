import Foundation

/// Widget copy from the generated `WidgetStrings` tables (@da/i18n `widgets.*`).
enum L10n {
  /// The language before the app wrote a snapshot (gallery, first run): the device language.
  static var deviceLanguage: String {
    Locale.preferredLanguages.first?.lowercased().hasPrefix("en") == true ? "en" : "tr"
  }

  static func language(_ snapshot: WidgetSnapshot?) -> String {
    snapshot?.locale == "en" ? "en" : (snapshot == nil ? deviceLanguage : "tr")
  }

  /// Formats `widgets.<key>`: `{arg}` placeholders, the flattened plural (`one` when the plural
  /// argument is 1) and the Turkish `{time_loc}` ("07:30'da") derived from `time`.
  static func t(_ key: String, _ lang: String, _ args: [String: Any] = [:]) -> String {
    let table = lang == "en" ? WidgetStrings.en : WidgetStrings.tr
    guard let entry = table[key] ?? WidgetStrings.tr[key] else { return "" }
    var text = entry.other
    if let arg = entry.plural, let count = args[arg] as? Int, count == 1 { text = entry.one }
    if text.contains("{time_loc}"), let time = args["time"] as? String {
      text = text.replacingOccurrences(of: "{time_loc}", with: trLocative(time))
    }
    for (name, value) in args {
      text = text.replacingOccurrences(of: "{\(name)}", with: "\(value)")
    }
    return text
  }

  /// Kickers and badges are upper-cased in the snapshot language ("SON TARİH").
  static func upper(_ text: String, _ lang: String) -> String {
    text.uppercased(with: Locale(identifier: lang == "en" ? "en_US" : "tr_TR"))
  }

  /// "07:30" → "07:30'da": the suffix follows the minutes, or the hour on the full hour.
  static func trLocative(_ time: String) -> String {
    let parts = time.split(separator: ":")
    guard parts.count >= 2, let hour = Int(parts[0].suffix(2)), let minute = Int(parts[1].prefix(2)),
      (0..<24).contains(hour), (0..<60).contains(minute)
    else { return time }
    let suffix =
      minute == 0
      ? WidgetStrings.trLocativeByHour[hour] : WidgetStrings.trLocativeByMinute[minute]
    return "\(time)'\(suffix)"
  }

  /// 24-hour clock in the device time zone (the snapshot's own labels are server-rendered).
  static func clock(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "HH:mm"
    return formatter.string(from: date)
  }

  /// `widgets.badge.*` key of a snapshot badge.
  static func badgeKey(_ badge: String) -> String {
    switch badge {
    case "ACİL": return "badge.urgent"
    case "SON TARİH": return "badge.deadline"
    case "TOPLANTI": return "badge.meeting"
    case "TAKİP": return "badge.followUp"
    case "KİŞİSEL": return "badge.personal"
    default: return "badge.security"
    }
  }

  static func badge(_ badge: String, _ lang: String) -> String {
    upper(t(badgeKey(badge), lang), lang)
  }
}
