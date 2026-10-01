Pod::Spec.new do |s|
  s.name         = "react-native-cgm-background"
  s.version      = "1.0.0"
  s.summary      = "HealthKit background delivery of blood glucose (Dexcom CGM) for CareView"
  s.homepage     = "https://trinitycareview.com"
  s.license      = "MIT"
  s.author       = "Trinity CareView"
  s.platform     = :ios, "13.0"
  s.source       = { :path => "." }
  s.source_files = "ios/**/*.{h,m}"
  s.frameworks   = "HealthKit"
  s.dependency "React-Core"
end
