#!/usr/bin/env bash
# アプリが起こしたサーバーを止める。
#
# 録音中に止めると、まだ送っていない最大 30 秒ぶんの音声が失われる。
# 会議を終了してから使うこと。
#
# launcher.sh は 3000 が埋まっていると 3001・3002 で起こすので、その範囲から探す。
# 同じ範囲で動いている他のアプリは止めない。
set -euo pipefail

source "$(cd "$(dirname "$0")" && pwd)/port.sh"

if ! PORT="$(find_running_port)"; then
  echo "ポート $PORT_CANDIDATES で動いている議事録アプリはありません"
  exit 0
fi

lsof -ti "tcp:$PORT" -sTCP:LISTEN | xargs kill
echo "ポート $PORT のサーバーを停止しました"
