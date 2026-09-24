import AVFoundation
import ExpoModulesCore

struct SynthesisOptions: Record {
  /// `AVSpeechSynthesisVoice.identifier` chosen by the JS voice selection; nil = the language default.
  @Field var voice: String?
  @Field var language: String = "tr-TR"
  /// `file://…/{chapter}-{part}.caf` in the cache directory.
  @Field var uri: String = ""
}

/// `DaTts` (T-8.27): synthesizes one text to one audio file with `AVSpeechSynthesizer.write`, so
/// the briefing player can seek and change speed on real files (expo-speech cannot).
public class DaTtsModule: Module {
  private var jobs: [ObjectIdentifier: SynthesisJob] = [:]

  public func definition() -> ModuleDefinition {
    Name("DaTts")

    AsyncFunction("getVoices") { () -> [[String: Any]] in
      AVSpeechSynthesisVoice.speechVoices().map { voice in
        [
          "identifier": voice.identifier,
          "name": voice.name,
          "language": voice.language,
          "quality": Self.quality(of: voice),
          "networkRequired": false,
        ]
      }
    }

    AsyncFunction("synthesizeToFile") { (text: String, options: SynthesisOptions, promise: Promise) in
      guard let url = URL(string: options.uri), url.isFileURL else {
        promise.reject("ERR_TTS_URI", "A file:// URI in the cache directory is required.")
        return
      }
      let job = SynthesisJob(url: url) { [weak self] job, result in
        self?.jobs[ObjectIdentifier(job)] = nil
        switch result {
        case .success(let durationMs):
          promise.resolve(["uri": url.absoluteString, "durationMs": durationMs])
        case .failure(let error):
          promise.reject("ERR_TTS_SYNTHESIS", error.localizedDescription)
        }
      }
      self.jobs[ObjectIdentifier(job)] = job
      job.start(text: text, voice: Self.voice(for: options))
    }.runOnQueue(.main)
  }

  static func voice(for options: SynthesisOptions) -> AVSpeechSynthesisVoice? {
    if let identifier = options.voice, let voice = AVSpeechSynthesisVoice(identifier: identifier) {
      return voice
    }
    return AVSpeechSynthesisVoice(language: options.language)
  }

  static func quality(of voice: AVSpeechSynthesisVoice) -> String {
    switch voice.quality {
    case .premium: return "premium"
    case .enhanced: return "enhanced"
    default: return "default"
    }
  }
}

enum SynthesisError: LocalizedError {
  case empty
  case cancelled

  var errorDescription: String? {
    switch self {
    case .empty: return "The synthesizer produced no audio."
    case .cancelled: return "The synthesis was cancelled."
    }
  }
}

/// One `AVSpeechSynthesizer.write` run into one PCM file. Buffers are written synchronously on a
/// private serial queue (they are only valid inside the callback); the job completes on the empty
/// end-of-speech buffer, or shortly after `didFinish` for voices that never send one.
final class SynthesisJob: NSObject, AVSpeechSynthesizerDelegate {
  private let synthesizer = AVSpeechSynthesizer()
  private let queue = DispatchQueue(label: "app.dijitalasistan.tts.write")
  private let url: URL
  private let completion: (SynthesisJob, Result<Double, Error>) -> Void
  private var file: AVAudioFile?
  private var frames: AVAudioFramePosition = 0
  private var sampleRate: Double = 0
  private var finished = false

  init(url: URL, completion: @escaping (SynthesisJob, Result<Double, Error>) -> Void) {
    self.url = url
    self.completion = completion
    super.init()
    synthesizer.delegate = self
  }

  func start(text: String, voice: AVSpeechSynthesisVoice?) {
    do {
      let manager = FileManager.default
      try manager.createDirectory(
        at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      if manager.fileExists(atPath: url.path) { try manager.removeItem(at: url) }
    } catch {
      queue.async { self.finish(.failure(error)) }
      return
    }
    let utterance = AVSpeechUtterance(string: text)
    utterance.voice = voice
    synthesizer.write(utterance) { [weak self] buffer in
      guard let self else { return }
      self.queue.sync { self.append(buffer) }
    }
  }

  private func append(_ buffer: AVAudioBuffer) {
    guard !finished, let pcm = buffer as? AVAudioPCMBuffer else { return }
    if pcm.frameLength == 0 {
      finish(nil)
      return
    }
    do {
      if file == nil {
        file = try AVAudioFile(
          forWriting: url, settings: pcm.format.settings, commonFormat: pcm.format.commonFormat,
          interleaved: pcm.format.isInterleaved)
        sampleRate = pcm.format.sampleRate
      }
      try file?.write(from: pcm)
      frames += AVAudioFramePosition(pcm.frameLength)
    } catch {
      finish(.failure(error))
    }
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    queue.asyncAfter(deadline: .now() + 0.3) { self.finish(nil) }
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    queue.async { self.finish(.failure(SynthesisError.cancelled)) }
  }

  /// Runs on `queue`; `nil` means success with the written duration.
  private func finish(_ outcome: Result<Double, Error>?) {
    guard !finished else { return }
    finished = true
    let result: Result<Double, Error>
    if let outcome {
      result = outcome
    } else if file != nil, sampleRate > 0 {
      result = .success(Double(frames) / sampleRate * 1000)
    } else {
      result = .failure(SynthesisError.empty)
    }
    file = nil  // Closes the file.
    if case .failure = result { try? FileManager.default.removeItem(at: url) }
    DispatchQueue.main.async { self.completion(self, result) }
  }
}
