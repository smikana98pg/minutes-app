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

# 🚨 --user-data-dir や --app で別インスタンスの Chrome を立ててはいけない。
# 画面共有ダイアログに出るのは「同じ Chrome インスタンスのタブ」だけなので、
# 別インスタンスで開くと会議のタブを選べず、相手の声が録れなくなる。
# 単独ウィンドウが欲しい場合は、普段の Chrome に PWA としてインストールする
# （アドレスバー右の インストール）。作られた .app があればそれを開く。
# zsh は一致しない glob をエラーにするので、探索は find に任せる
PWA="$(find "$HOME/Applications" -maxdepth 2 -name '議事録.app' -path '*Chrome Apps*' -print -quit 2>/dev/null)"

if [ -n "$PWA" ]; then
  open "$PWA"
else
  open -a "Google Chrome" "$URL"
fi
