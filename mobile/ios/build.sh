#!/usr/bin/env bash
# Сборка приложения для iOS на своём Mac: одна команда — веб-часть, синк с Capacitor и xcodebuild.
#   ./mobile/ios/build.sh            — сборка для симулятора (подпись не нужна)
#   ./mobile/ios/build.sh device     — сборка для своего телефона (нужен Apple ID в Xcode)
# Результат: mobile/ios/build/Build/Products/…
set -euo pipefail

cd "$(dirname "$0")/../.."

SDK="iphonesimulator"
DESTINATION="generic/platform=iOS Simulator"
EXTRA="CODE_SIGNING_ALLOWED=NO"

if [ "${1:-}" = "device" ]; then
  SDK="iphoneos"
  DESTINATION="generic/platform=iOS"
  EXTRA=""
fi

echo "→ веб-часть и мост"
node mobile/build.mjs ios

echo "→ cap sync"
npx cap sync ios

echo "→ xcodebuild"
set -o pipefail
xcodebuild \
  -project mobile/ios/App/App.xcodeproj \
  -scheme App \
  -configuration Debug \
  -sdk "$SDK" \
  -destination "$DESTINATION" \
  -derivedDataPath mobile/ios/build \
  $EXTRA \
  build | tee mobile/ios/build.log

echo
echo "Готово: mobile/ios/build/Build/Products"
