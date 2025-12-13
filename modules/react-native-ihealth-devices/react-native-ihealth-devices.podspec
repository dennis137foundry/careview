Pod::Spec.new do |s|
  s.name         = "react-native-ihealth-devices"
  s.version      = "1.0.0"
  s.summary      = "React Native bridge for iHealth medical devices"
  s.homepage     = "https://github.com/example/react-native-ihealth-devices"
  s.license      = "MIT"
  s.author       = "Trinity CareView"
  s.platform     = :ios, "13.0"
  s.source       = { :path => "." }
  s.source_files = "ios/**/*.{h,m}"
  s.vendored_libraries = "ios/libiHealthSDK2.14.0.a"
  s.frameworks   = "CoreBluetooth", "ExternalAccessory"
  s.dependency "React-Core"
  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/ios/Headers"'
  }
end
