Pod::Spec.new do |s|
  s.name           = 'DaTts'
  s.version        = '1.0.0'
  s.summary        = 'Dijital Asistan on-device text-to-speech to audio files (AVSpeechSynthesizer.write).'
  s.description    = 'Synthesizes briefing chapters to CAF files in the cache for the briefing player.'
  s.author         = 'Dijital Asistan'
  s.homepage       = 'https://dijitalasistan.app'
  s.license        = { type: 'UNLICENSED' }
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
