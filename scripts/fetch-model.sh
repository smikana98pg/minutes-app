#!/usr/bin/env bash
# whisper.cpp の GGML モデルを models/ に取得する。
#
# 既定は large-v3-turbo の q5_0 量子化版（約574MB）。M1 8GB でも余裕を持って載り、
# 日本語の精度は large 級のまま実時間の 1/5〜1/8 程度で処理できる。
# 文字起こしが遅すぎる場合は `./scripts/fetch-model.sh small` で軽量版に落とせる。
set -euo pipefail

MODEL="${1:-large-v3-turbo-q5_0}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/models/ggml-${MODEL}.bin"
URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${MODEL}.bin"

if [ -f "$DEST" ]; then
  echo "既に存在します: $DEST"
  exit 0
fi

echo "取得中: $URL"
curl -L --fail --progress-bar -o "$DEST.part" "$URL"
mv "$DEST.part" "$DEST"
echo "完了: $DEST ($(du -h "$DEST" | cut -f1))"
