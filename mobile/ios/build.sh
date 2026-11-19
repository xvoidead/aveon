#!/usr/bin/env bash
# Сборка приложения для iOS на своём Mac: одна команда — веб-часть, синк с Capacitor и xcodebuild.
#   ./mobile/ios/build.sh            — сборка для симулятора (подпись не нужна)
#   ./mobile/ios/build.sh device     — сборка для своего телефона (нужен Apple ID в Xcode)
#   ./mobile/ios/build.sh ipa        — сборка для телефона без подписи + aveon-ios-unsigned.ipa
# Результат: mobile/ios/build/Build/Products/…
set -euo pipefail

cd "$(dirname "$0")/../.."

SDK="iphonesimulator"
DESTINATION="generic/platform=iOS Simulator"
EXTRA="CODE_SIGNING_ALLOWED=NO"
DERIVED="mobile/ios/build"
LOG="mobile/ios/build.log"

case "${1:-}" in
  device)
    SDK="iphoneos"
    DESTINATION="generic/platform=iOS"
    EXTRA=""
    ;;
  ipa)
    SDK="iphoneos"
    DESTINATION="generic/platform=iOS"
    EXTRA="CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="
    DERIVED="mobile/ios/build-device"
    LOG="mobile/ios/build-device.log"
    ;;
esac

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
  -derivedDataPath "$DERIVED" \
  $EXTRA \
  build | tee "$LOG"

if [ "${1:-}" = "ipa" ]; then
  echo "→ упаковываем ipa"
  APP="$DERIVED/Build/Products/Debug-iphoneos/App.app"
  rm -rf mobile/ios/ipa-payload && mkdir -p mobile/ios/ipa-payload/Payload
  cp -R "$APP" mobile/ios/ipa-payload/Payload/
  (cd mobile/ios/ipa-payload && zip -qry "$OLDPWD/aveon-ios-unsigned.ipa" Payload)
  rm -rf mobile/ios/ipa-payload
  echo "Готово: aveon-ios-unsigned.ipa (подпиши его своим Apple ID, чтобы поставить на телефон)"
fi

echo
echo "Готово: $DERIVED/Build/Products"
