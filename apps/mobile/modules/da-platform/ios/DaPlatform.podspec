Pod::Spec.new do |s|
  s.name           = 'DaPlatform'
  s.version        = '1.0.0'
  s.summary        = 'Dijital Asistan platform capability state (Time Sensitive notification setting).'
  s.description    = 'Reads UNNotificationSettings.timeSensitiveSetting and opens the app notification settings.'
  s.author         = 'Dijital Asistan'
  s.homepage       = 'https://dijitalasistan.app'
  s.license        = { type: 'UNLICENSED' }
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'UserNotifications', 'UIKit'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
