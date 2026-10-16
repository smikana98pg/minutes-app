# launcher.sh と stop.sh から source する、ポートの探し方。
#
# 3000 が他のアプリ（別プロジェクトの next dev など）に使われていても起動できるよう、
# 3000 → 3001 → 3002 の順に試す。MINUTES_PORT を渡すとそこから 3 つを試す。
# zsh（launcher.sh）と bash（stop.sh）の両方から読むので、どちらでも動く書き方に留める。

PORT_FIRST="${MINUTES_PORT:-3000}"
PORT_CANDIDATES="$PORT_FIRST $((PORT_FIRST + 1)) $((PORT_FIRST + 2))"

# そのポートで動いているのが議事録アプリか。
# 「応答がある」だけでは他のアプリと区別できないので、manifest の説明文で見分ける。
is_minutes() {
  curl -sf --max-time 1 "http://localhost:$1/manifest.webmanifest" 2>/dev/null |
    grep -q '会議の音声から議事録を自動生成する'
}

# 何も待ち受けていないか。IPv4 / IPv6 のどちらで待ち受けていても使用中とみなす。
is_free() {
  [ -z "$(lsof -ti "tcp:$1" -sTCP:LISTEN 2>/dev/null)" ]
}

# 議事録アプリが動いているポートを出力する。無ければ失敗で返る。
find_running_port() {
  for p in $(echo $PORT_CANDIDATES); do
    if is_minutes "$p"; then
      echo "$p"
      return 0
    fi
  done
  return 1
}

# 空いている最初のポートを出力する。全部埋まっていれば失敗で返る。
find_free_port() {
  for p in $(echo $PORT_CANDIDATES); do
    if is_free "$p"; then
      echo "$p"
      return 0
    fi
  done
  return 1
}
