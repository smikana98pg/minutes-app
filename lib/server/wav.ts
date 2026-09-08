import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { BYTES_PER_SAMPLE, CHANNELS, SAMPLE_RATE } from '@/lib/types';

const INT16_MAX = 32767;
const INT16_MIN = -32768;

/**
 * 音量を揃える単位。
 *
 * 一律のゲインでは直らない。対面会議の録音は「近くの人の声」と「奥の席の声」で
 * 10dB 以上ひらくことがあり、全体を持ち上げても比率は変わらないため、
 * 静かな区間は whisper の発話判定を下回ったままになる（実測で、
 * 全体を +18dB しても文字起こしは「音楽」のまま／窓ごとに揃えると全文復元した）。
 * 500ms ごとに見て、区間単位で持ち上げる。
 */
const FRAME_MS = 500;
const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000;

/**
 * ゲインを平滑化する範囲（前後のフレーム数）。
 * 窓ごとに独立して掛けると、息継ぎのたびに音量が上下して不自然になる。
 * 前後 7.5 秒ぶんをガウス窓でならし、発話のまとまりに沿って緩やかに変える。
 */
const SMOOTH_RADIUS = 15;

/** 各フレームのピークをここまで持ち上げる。 */
const TARGET_PEAK_DBFS = -3;

/**
 * これ以下は暗騒音とみなし、ゲインの計算では下限として扱う。
 * 本当の無音を割り算に持ち込むとゲインが発散する。
 */
const NOISE_FLOOR_DBFS = -60;

/** 増幅の上限（dB）。これ以上持ち上げても雑音が増えるだけ。 */
const MAX_GAIN_DB = 30;

/** 全体がこれ以下なら、そもそも何も録れていないとみなして手を加えない。 */
const SILENCE_RMS_DBFS = -70;

const toAmplitude = (dbfs: number) => 10 ** (dbfs / 20) * INT16_MAX;

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

/** PCM を 1 サンプルずつ渡す。チャンクの境界でサンプルが割れても取りこぼさない。 */
async function forEachSample(
  pcmPath: string,
  visit: (sample: number) => void,
): Promise<void> {
  let leftover: Buffer | null = null;

  for await (const chunk of createReadStream(pcmPath)) {
    const read = chunk as Buffer;
    const buf: Buffer = leftover ? Buffer.concat([leftover, read]) : read;
    const usable = buf.length - (buf.length % BYTES_PER_SAMPLE);
    for (let i = 0; i < usable; i += BYTES_PER_SAMPLE) visit(buf.readInt16LE(i));
    leftover = usable < buf.length ? buf.subarray(usable) : null;
  }
}

/** ガウス窓で移動平均を取る。端は最も近い値で埋める。 */
function smooth(values: Float64Array, radius: number): Float64Array {
  const sigma = radius / 3;
  const kernel = new Float64Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = w;
    sum += w;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  const out = new Float64Array(values.length);
  const last = values.length - 1;
  for (let i = 0; i < values.length; i++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = Math.min(Math.max(i + k, 0), last);
      acc += values[j] * kernel[k + radius];
    }
    out[i] = acc;
  }
  return out;
}

type Levels = {
  /** フレームごとに掛けるゲイン（平滑化済み）。全て 1 なら手を加えない。 */
  gains: Float64Array;
  /** 元の音声の実効音量。文字起こしが空だったときの原因切り分けに使う。 */
  rmsDbfs: number;
};

/**
 * フレームごとのピークを測り、掛けるゲインを決める。
 *
 * 素のピークではなくフレーム単位で見るので、机を叩く音が 1 回入っても
 * その 500ms のゲインが下がるだけで、他の区間は影響を受けない。
 */
async function measure(pcmPath: string): Promise<Levels> {
  const peaks: number[] = [];
  let framePeak = 0;
  let inFrame = 0;
  let count = 0;
  let sumSquares = 0;

  await forEachSample(pcmPath, (sample) => {
    const abs = Math.abs(sample);
    if (abs > framePeak) framePeak = abs;
    sumSquares += sample * sample;
    count++;
    if (++inFrame === FRAME_SAMPLES) {
      peaks.push(framePeak);
      framePeak = 0;
      inFrame = 0;
    }
  });
  if (inFrame > 0) peaks.push(framePeak); // 端数のフレーム

  const rms = count === 0 ? 0 : Math.sqrt(sumSquares / count);
  const rmsDbfs = rms === 0 ? -Infinity : 20 * Math.log10(rms / INT16_MAX);
  const flat = { gains: new Float64Array(peaks.length).fill(1), rmsDbfs };

  if (peaks.length === 0 || rms <= toAmplitude(SILENCE_RMS_DBFS)) return flat;

  const target = toAmplitude(TARGET_PEAK_DBFS);
  const floor = toAmplitude(NOISE_FLOOR_DBFS);
  const maxGain = 10 ** (MAX_GAIN_DB / 20);

  const raw = new Float64Array(peaks.length);
  for (let i = 0; i < peaks.length; i++) {
    // 下げる方向には動かさない。元から大きい区間はそのまま通す
    raw[i] = Math.min(maxGain, Math.max(1, target / Math.max(peaks[i], floor)));
  }

  return { gains: smooth(raw, SMOOTH_RADIUS), rmsDbfs };
}

/** フレームごとのゲインを、隣と線形補間しながら掛ける。範囲外はクリップする。 */
class DynamicGain extends Transform {
  private leftover: Buffer | null = null;
  private index = 0;

  constructor(private readonly gains: Float64Array) {
    super();
  }

  /** サンプル n に掛けるゲイン。フレームの中心どうしを結んで補間する。 */
  private gainAt(n: number): number {
    const last = this.gains.length - 1;
    const t = n / FRAME_SAMPLES - 0.5;
    const i = Math.floor(t);
    const a = this.gains[Math.min(Math.max(i, 0), last)];
    const b = this.gains[Math.min(Math.max(i + 1, 0), last)];
    return a + (b - a) * (t - i);
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    const buf = this.leftover ? Buffer.concat([this.leftover, chunk]) : chunk;
    const usable = buf.length - (buf.length % BYTES_PER_SAMPLE);
    this.leftover = usable < buf.length ? buf.subarray(usable) : null;

    const out = Buffer.allocUnsafe(usable);
    for (let i = 0; i < usable; i += BYTES_PER_SAMPLE) {
      const v = Math.round(buf.readInt16LE(i) * this.gainAt(this.index++));
      out.writeInt16LE(v > INT16_MAX ? INT16_MAX : v < INT16_MIN ? INT16_MIN : v, i);
    }
    done(null, out);
  }

  _flush(done: TransformCallback): void {
    // 端数の 1 バイトは 1 サンプルに満たないので捨てる
    done();
  }
}

export type WavResult = {
  durationSec: number;
  /** 増幅する前の実効音量（dBFS）。 */
  rmsDbfs: number;
  /** 実際に掛けた増幅量の中央値（dB）。0 なら手を加えていない。 */
  gainDb: number;
};

/**
 * 生 PCM ファイルに WAV ヘッダを付けて書き出す。
 *
 * 同時に音量を揃える。対面会議はマイク1本ぶんしか音源が無く、そのまま渡すと
 * whisper が発話ごと非発話として捨てることがあるため（→ FRAME_MS）。
 * 元の audio.pcm は触らないので、生の入力レベルは preview.sh で確認できる。
 *
 * 1 時間の会議で PCM は約 115MB になるため、メモリに読み込まず
 * ストリームで流し込む。
 */
export async function pcmToWav(pcmPath: string, wavPath: string): Promise<WavResult> {
  let size: number;
  try {
    ({ size } = await stat(pcmPath));
  } catch {
    // 議事録を残して音声だけ消したあとに再実行された場合ここに来る
    throw new Error('音声が削除されているため、文字起こしをやり直せません');
  }
  if (size === 0) throw new Error('録音データが空です');

  const { gains, rmsDbfs } = await measure(pcmPath);
  const touched = gains.some((g) => g > 1.01);

  const out = createWriteStream(wavPath);
  out.write(wavHeader(size));
  const src = createReadStream(pcmPath);
  await (touched ? pipeline(src, new DynamicGain(gains), out) : pipeline(src, out));

  const sorted = Float64Array.from(gains).sort();
  const median = sorted.length === 0 ? 1 : sorted[Math.floor(sorted.length / 2)];

  return {
    durationSec: size / (SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE),
    rmsDbfs,
    gainDb: 20 * Math.log10(median),
  };
}

/** PCM のバイト数から収録秒数を求める。 */
export function pcmDurationSec(bytes: number): number {
  return bytes / (SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE);
}
