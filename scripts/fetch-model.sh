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

# 文字起こしの前に発話区間を切り出す VAD モデル（約 1MB）。どのモデルでも必要。
VAD_DEST="$(dirname "$DEST")/ggml-silero-v5.1.2.bin"
VAD_URL="https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin"

fetch() {
  local url="$1" dest="$2"
  if [ -f "$dest" ]; then
    echo "既に存在します: $dest"
    return
  fi
  echo "取得中: $url"
  curl -L --fail --progress-bar -o "$dest.part" "$url"
  mv "$dest.part" "$dest"
  echo "完了: $dest ($(du -h "$dest" | cut -f1))"
}

fetch "$URL" "$DEST"
fetch "$VAD_URL" "$VAD_DEST"
