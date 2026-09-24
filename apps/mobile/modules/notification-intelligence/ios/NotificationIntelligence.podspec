Pod::Spec.new do |s|
  s.name           = 'NotificationIntelligence'
  s.version        = '1.0.0'
  s.summary        = 'Android Notification Intelligence (iOS stub: unavailable)'
  s.description    = 'Reports that notification intelligence is not available on iOS.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift}"
end
