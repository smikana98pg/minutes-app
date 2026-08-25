import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

import { BYTES_PER_SAMPLE, CHANNELS, SAMPLE_RATE } from '@/lib/types';

/**
 * s16le / 16kHz / mono の生 PCM 用の 44 バイト WAV ヘッダを組む。
 *
 * ffmpeg でも同じことはできるが、フォーマットが分かりきっているぶん
 * ヘッダを直接書く方が速く、外部プロセスへの依存も減らせる。
 */
function wavHeader(dataBytes: number): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataBytes, 4); // RIFF チャンクのサイズ
  header.write('WAVE', 8, 'ascii');

  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // fmt チャンクのサイズ（PCM は 16）
  header.writeUInt16LE(1, 20); // フォーマット 1 = リニア PCM
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(CHANNELS * BYTES_PER_SAMPLE, 32); // ブロックアライン
  header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34); // ビット深度

  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataBytes, 40);

  return header;
}

/**
 * 生 PCM ファイルに WAV ヘッダを付けて書き出す。
 *
 * 1 時間の会議で PCM は約 115MB になるため、メモリに読み込まず
 * ストリームで流し込む。戻り値は音声の長さ（秒）。
 */
export async function pcmToWav(pcmPath: string, wavPath: string): Promise<number> {
  let size: number;
  try {
    ({ size } = await stat(pcmPath));
  } catch {
    // 議事録を残して音声だけ消したあとに再実行された場合ここに来る
    throw new Error('音声が削除されているため、文字起こしをやり直せません');
  }
  if (size === 0) throw new Error('録音データが空です');

  const out = createWriteStream(wavPath);
  out.write(wavHeader(size));
  await pipeline(createReadStream(pcmPath), out);

  return size / (SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE);
}

/** PCM のバイト数から収録秒数を求める。 */
export function pcmDurationSec(bytes: number): number {
  return bytes / (SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE);
}
