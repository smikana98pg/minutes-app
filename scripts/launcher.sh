#!/bin/zsh
# 「議事録」アプリの実体。
# ~/Applications/議事録.app はこのスクリプトを呼ぶだけのアプレットなので、
# ここを直せばアプリを作り直さなくても挙動が変わる。

# Finder / Launchpad から起動されたプロセスは最小の PATH しか持たない。
# node も pnpm も whisper-cpp も claude も Homebrew 側にあるので自分で通す。
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${MINUTES_PORT:-3000}"
URL="http://localhost:$PORT"
LOG="$ROOT/data/server.log"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

cd "$ROOT" || exit 1
mkdir -p "$(dirname "$LOG")"

fail() {
  osascript -e "display alert \"議事録を起動できませんでした\" message \"$1\"" >/dev/null
  exit 1
}

alive() { curl -sf -o /dev/null --max-time 1 "$URL"; }

if ! alive; then
  # 初回だけビルドが要る。1 分ほどかかる。
  [ -d .next ] || pnpm build >>"$LOG" 2>&1 || fail "ビルドに失敗しました。data/server.log を見てください。"
  nohup pnpm start -p "$PORT" >>"$LOG" 2>&1 &
  for _ in {1..60}; do
    alive && break
    sleep 0.5
  done
fi

alive || fail "サーバーが起動しませんでした。data/server.log を見てください。"

# 🚨 --user-data-dir は外せない。
# 普段の Chrome が動いていると --app は既存インスタンスへ転送され、
# ウィンドウの種類を指定した引数は捨てられてしまう（何も開かない）。
# 専用プロファイルで独立したインスタンスとして起動して初めて app ウィンドウになる。
"$CHROME" --app="$URL" \
  --user-data-dir="$ROOT/data/chrome-profile" \
  --no-first-run --no-default-browser-check >/dev/null 2>&1 &
