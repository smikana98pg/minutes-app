import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type { TranscriptSegment } from '@/lib/types';

import { config } from './config';

const execFileAsync = promisify(execFile);

/** whisper-cli が -oj で書き出す JSON のうち、こちらが読む部分。 */
type WhisperJson = {
  transcription: {
    offsets: { from: number; to: number };
    text: string;
  }[];
};

/**
 * whisper.cpp をローカルで走らせて文字起こしする。
 *
 * M1 の実測で 31 秒の音声が約 8 秒（うちモデル読み込み約 4 秒）だったので、
 * 1 時間の会議はおおむね 8 分前後かかる。タイムアウトは余裕を持って 2 時間。
 */
export async function transcribe(wavPath: string): Promise<TranscriptSegment[]> {
  // whisper-cli は -of に拡張子なしのパスを取り、自分で .json を足す。
  const outPrefix = path.join(path.dirname(wavPath), 'transcript');

  await execFileAsync(
    config.whisperBin,
    [
      '-m', config.whisperModel,
      '-f', wavPath,
      '-l', 'ja',
      '-t', config.whisperThreads,
      '-oj',
      '-of', outPrefix,
      '-np', // 認識結果以外を標準出力に出させない
    ],
    { timeout: 2 * 60 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 },
  );

  const json = JSON.parse(await readFile(`${outPrefix}.json`, 'utf8')) as WhisperJson;

  return json.transcription
    .map((s) => ({
      startMs: s.offsets.from,
      endMs: s.offsets.to,
      text: s.text.trim(),
    }))
    // whisper は無音区間に空セグメントや [音楽] のような注記を返すことがある
    .filter((s) => s.text.length > 0 && !/^\[.*\]$/.test(s.text));
}

function hhmmss(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/** タイムスタンプ付きの文字起こし全文を Markdown にする。 */
export function segmentsToMarkdown(segments: TranscriptSegment[]): string {
  return segments.map((s) => `[${hhmmss(s.startMs)}] ${s.text}`).join('\n');
}

/** 要約に渡すプレーンテキスト。タイムスタンプは根拠を辿れるよう残す。 */
export function segmentsToPlainText(segments: TranscriptSegment[]): string {
  return segments.map((s) => `[${hhmmss(s.startMs)}] ${s.text}`).join('\n');
}
