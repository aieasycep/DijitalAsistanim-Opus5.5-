Pod::Spec.new do |s|
  s.name           = 'DaWidgets'
  s.version        = '1.0.0'
  s.summary        = 'Dijital Asistan widget snapshot bridge (App Group + WidgetKit reload).'
  s.description    = 'Writes the WidgetSnapshotV1 JSON to the App Group and reloads the widget timelines.'
  s.author         = 'Dijital Asistan'
  s.homepage       = 'https://dijitalasistan.app'
  s.license        = { type: 'UNLICENSED' }
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WidgetKit'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
