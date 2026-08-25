#!/usr/bin/env bash
# 録音中／録音済みの音声を再生できる形にして開く。
#
# 会議を終了する前でも audio.pcm はその時点まで書かれているので、
# 「マイクとタブ音声が両方入っているか」を耳で確かめるのに使う。
#
#   ./scripts/preview.sh            最新の会議
#   ./scripts/preview.sh <会議ID>   指定した会議
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${ROOT}/data/meetings"

ID="${1:-$(ls -t "$DIR" 2>/dev/null | head -1)}"
[ -n "$ID" ] || { echo "会議がありません"; exit 1; }

PCM="$DIR/$ID/audio.pcm"
[ -f "$PCM" ] || { echo "音声がありません: $PCM"; exit 1; }

BYTES=$(stat -f%z "$PCM")
if [ "$BYTES" -eq 0 ]; then
  echo "会議 $ID の音声はまだ 0 バイトです。"
  echo "「録音を開始」を押していないか、最初の送信（30秒間隔）がまだ来ていません。"
  exit 1
fi

OUT="/tmp/minutes-preview-$ID.wav"
ffmpeg -y -loglevel error -f s16le -ar 16000 -ac 1 -i "$PCM" "$OUT"

printf '会議 %s\n  収録: %.1f 秒 (%s)\n  出力: %s\n' \
  "$ID" "$(echo "$BYTES / 32000" | bc -l)" "$(du -h "$PCM" | cut -f1)" "$OUT"

# 平均音量が -91dB 近辺なら実質無音。マイクもタブ音声も入っていない疑いがある。
echo "  音量:"
ffmpeg -hide_banner -i "$OUT" -af volumedetect -f null - 2>&1 \
  | grep -E 'mean_volume|max_volume' | sed 's/.*\] /    /'

open "$OUT"
