#!/usr/bin/env bash
# 「議事録」を macOS のアプリとして ~/Applications に作る。
#
# 中身は scripts/launcher.sh を呼ぶだけのアプレット。やることは2つ。
#   1. サーバー（next start）が動いていなければ起こす
#   2. Chrome を --app モードで開く（アドレスバーの無い単独ウィンドウ）
#
# Electron のような同梱アプリではないので、録音もタブ音声の取得も
# 普段の Chrome の仕組みがそのまま使える。
#
#   ./scripts/make-app.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/Applications/議事録.app"
SRC_ICON="$ROOT/public/app-icon.png"

[ -f "$SRC_ICON" ] || { echo "アイコンがありません: $SRC_ICON" >&2; exit 1; }
[ -d "/Applications/Google Chrome.app" ] || { echo "Google Chrome が見つかりません" >&2; exit 1; }

mkdir -p "$HOME/Applications"
rm -rf "$APP"

# 🚨 バンドルを自前で組んではいけない。
# Info.plist と shell スクリプトだけの .app は LaunchServices にチェックインしないため、
# open が -1712（起動タイムアウト）で失敗する。osacompile が作るのは Cocoa のアプレットで、
# これは正規のアプリとして扱われる。
osacompile -o "$APP" \
  -e "do shell script \"nohup '$ROOT/scripts/launcher.sh' > /dev/null 2>&1 &\""

# --- 表示名 -----------------------------------------------------------------
PLIST="$APP/Contents/Info.plist"
plist_set() {
  /usr/libexec/PlistBuddy -c "Set :$1 $2" "$PLIST" 2>/dev/null ||
    /usr/libexec/PlistBuddy -c "Add :$1 string $2" "$PLIST"
}
plist_set CFBundleName 議事録
plist_set CFBundleDisplayName 議事録
plist_set CFBundleIdentifier local.minutes-app.launcher
plist_set CFBundleShortVersionString 0.1.0
plutil -lint "$PLIST" >/dev/null

# --- アイコン ---------------------------------------------------------------
# osacompile が置いたアプレットのアイコンを差し替える
WORK="$(mktemp -d)"
ICONSET="$WORK/icon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$SRC_ICON" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -z "$((size * 2))" "$((size * 2))" "$SRC_ICON" \
    --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/applet.icns"
rm -rf "$WORK"

# 🚨 Info.plist とアイコンを書き換えた時点で osacompile の ad-hoc 署名は壊れている。
# そのままにすると「アプリが壊れているため開けません」になるので署名し直す。
codesign --force --sign - "$APP"

# Finder に古いアイコンを出させない
touch "$APP"

echo "作成しました: $APP"
echo "Launchpad か Spotlight から「議事録」で開けます。"
