#!/usr/bin/env bash
# アプリが起こしたサーバーを止める。
#
# 録音中に止めると、まだ送っていない最大 30 秒ぶんの音声が失われる。
# 会議を終了してから使うこと。
set -euo pipefail

PORT="${MINUTES_PORT:-3000}"
PIDS="$(lsof -ti "tcp:$PORT" -sTCP:LISTEN || true)"

if [ -z "$PIDS" ]; then
  echo "ポート $PORT で動いているサーバーはありません"
  exit 0
fi

echo "$PIDS" | xargs kill
echo "停止しました"
