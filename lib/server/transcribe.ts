import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type { TranscriptSegment } from '@/lib/types';

import { config } from './config';

const execFileAsync = promisify(execFile);

/**
 * whisper が非発話の区間に対して返す定型文。
 *
 * `[音楽]` のように括弧が付くこともあれば、学習データ（字幕）に引きずられて
 * 括弧なしの本文として出てくることもある。会議の発言としては現れない文字列なので、
 * セグメント全体がこれと一致するときだけ落とす。
 * ここを通してしまうと、実際には何も録れていない会議から
 * それらしい議事録ができてしまい、失敗に気づけない。
 */
const NON_SPEECH = new Set([
  '音楽',
  '拍手',
  '笑い',
  '沈黙',
  '無音',
  'ご視聴ありがとうございました',
  'ご視聴ありがとうございました。',
  'おわり',
  '終わり',
]);

function isNonSpeech(text: string): boolean {
  // 括弧つきの注記（[音楽]、（拍手）など）と、括弧なしの定型文の両方を見る
  const bare = text.replace(/^[[(（【]|[\])）】]$/g, '').trim();
  return /^\[.*\]$/.test(text) || NON_SPEECH.has(bare);
}

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
 *
 * VAD は必須。無しで先頭から通すと、冒頭の待機時間などで一度
 * 「ご視聴ありがとうございました」と誤認識した後、明瞭な会話が始まっても
 * 30 秒ごとに同じ文を出し続けて抜けられないことがある（実測で 10 分ぶん、
 * 悪いときは 1 時間丸ごと失った。同じ区間を単独で渡すと全文認識できる）。
 * -mc 0 で文脈を切っても回復が早まるだけで直らない。
 * VAD で発話区間だけを渡すと起きなくなり、タイムスタンプは元の音声の時刻で返る。
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
      '--vad',
      '-vm', config.whisperVadModel,
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
    // whisper は無音区間に空セグメントや「音楽」のような注記を返すことがある
    .filter((s) => s.text.length > 0 && !isNonSpeech(s.text));
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
