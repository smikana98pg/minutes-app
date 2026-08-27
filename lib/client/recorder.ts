import { SAMPLE_RATE, type MeetingMode } from '@/lib/types';

/** 何秒ぶん溜めてからサーバーへ送るか。30 秒で約 960KB。 */
const FLUSH_INTERVAL_MS = 30_000;

export type RecorderEvents = {
  /** レベルメーター用の音量（0〜1）。 */
  onLevel?: (rms: number) => void;
  /** 送信の失敗など、録音を止めるほどではない問題。 */
  onWarning?: (message: string) => void;
  /** 画面共有がユーザーによって停止されたとき。 */
  onDisplayEnded?: () => void;
};

export type StartResult = {
  recorder: MeetingRecorder;
  /** タブ音声を取得できたか。オンライン会議で false ならマイクのみで録っている。 */
  hasTabAudio: boolean;
};

export type StartOptions = {
  mode: MeetingMode;
  /** 使うマイク。未指定ならシステムの既定。 */
  deviceId?: string;
};

/**
 * マイクの候補を返す。
 *
 * ラベルはマイクの許可を出したあとにしか入らないので、
 * 許可前に呼ぶと名前のない項目が並ぶ。
 */
export async function listAudioInputs(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default');
}

/**
 * マイクの制約。会議のとり方で最適値が逆になる。
 *
 * オンラインは自分ひとりの近接音声なので、3 つとも入れた方が素直に良くなる。
 * 特に echoCancellation は、スピーカーから出る相手の声がマイクに回り込んで
 * タブ音声側と二重に文字起こしされるのを防ぐために要る。
 *
 * 対面は部屋全体を 1 本で拾うため事情が違う。
 * - echoCancellation はスピーカー出力と相関する音を削る仕組みで、
 *   出力が無くても離れた席の声を誤って削ることがある
 * - noiseSuppression も近接音声を前提にしており、奥の席の小さな声ごと落としやすい
 * - autoGainControl だけは残す。テーブルの奥の声を持ち上げてくれる
 */
function audioConstraints(options: StartOptions): MediaTrackConstraints {
  // 未指定だとブラウザのシステム既定になる。macOS は iPhone が近くにあると
  // 連係のマイクを既定にしてしまうので、選ばれたマイクは exact で固定する。
  const device = options.deviceId ? { deviceId: { exact: options.deviceId } } : {};

  if (options.mode === 'inperson') {
    return {
      ...device,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
    };
  }
  return {
    ...device,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
}

function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    // クリッピングを防いでから 16bit に丸める
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export class MeetingRecorder {
  private pending: Float32Array[] = [];
  private timer: number | null = null;
  private stopped = false;
  /**
   * 送信を直列化するためのチェーン。
   * サーバー側は受け取った順に PCM を追記するので、interval の送信と stop() の送信が
   * 重なって後発が先に届くと、音声の順序が入れ替わって壊れる。
   */
  private chain: Promise<void> = Promise.resolve();

  private constructor(
    private readonly meetingId: string,
    private readonly ctx: AudioContext,
    private readonly streams: MediaStream[],
    private readonly events: RecorderEvents,
  ) {}

  static async start(
    meetingId: string,
    options: StartOptions,
    events: RecorderEvents = {},
  ): Promise<StartResult> {
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints(options),
    });

    // 対面会議はマイク 1 本で完結する。画面共有は求めない。
    let display: MediaStream | null = null;
    let hasTabAudio = false;

    if (options.mode === 'online') {
      // 相手の声。Chrome は video: true が無いとタブ音声を渡さないため必須。
      try {
        display = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
      } catch {
        mic.getTracks().forEach((t) => t.stop());
        throw new Error('画面共有がキャンセルされました');
      }
      hasTabAudio = display.getAudioTracks().length > 0;
    }

    // whisper が要求する 16kHz を AudioContext に指定すれば、
    // リサンプリングはブラウザ側がやってくれる。自前の変換は不要。
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    await ctx.audioWorklet.addModule('/pcm-worklet.js');

    const node = new AudioWorkletNode(ctx, 'pcm-collector', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      // explicit + 1ch にすることで、ステレオのタブ音声もここでモノラルに落ちる
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });

    // 同じノードの同じ入力に繋ぐと Web Audio が自動で加算ミックスする
    ctx.createMediaStreamSource(mic).connect(node);
    if (display && hasTabAudio) ctx.createMediaStreamSource(display).connect(node);

    // 出力が destination まで届かないノードはグラフに引かれず process() が呼ばれない。
    // gain 0 を挟んで繋ぐことで、音を出さずに確実に動かす。
    const silent = ctx.createGain();
    silent.gain.value = 0;
    node.connect(silent).connect(ctx.destination);

    const streams = display ? [mic, display] : [mic];
    const recorder = new MeetingRecorder(meetingId, ctx, streams, events);

    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      recorder.pending.push(e.data);
      events.onLevel?.(rms(e.data));
    };

    // Chrome の「共有を停止」バーで画面共有を終了した場合を拾う
    display?.getVideoTracks()[0]?.addEventListener('ended', () => {
      events.onDisplayEnded?.();
    });

    recorder.timer = window.setInterval(() => {
      void recorder.flush();
    }, FLUSH_INTERVAL_MS);

    return { recorder, hasTabAudio };
  }

  /** 溜まっている PCM をサーバーへ送る。前の送信の完了を待ってから走る。 */
  private flush(): Promise<void> {
    this.chain = this.chain.then(() => this.sendPending());
    return this.chain;
  }

  private async sendPending(): Promise<void> {
    if (this.pending.length === 0) return;

    const chunks = this.pending;
    this.pending = [];

    const total = chunks.reduce((n, c) => n + c.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }

    const pcm = floatToInt16(merged);
    try {
      const res = await fetch(`/api/meetings/${this.meetingId}/chunk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: pcm.buffer as ArrayBuffer,
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
    } catch (e) {
      // 送信に失敗したぶんは戻して次回に再送する
      this.pending.unshift(merged);
      this.events.onWarning?.(
        `録音データの送信に失敗しました（次回まとめて再送します）: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  /** 録音を止め、残りを送りきる。 */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    if (this.timer !== null) window.clearInterval(this.timer);
    await this.flush();

    for (const stream of this.streams) {
      // ここで初めて video トラックも止める。録音中に止めると Chrome が
      // 画面共有ごと終了させ、タブ音声まで切れてしまう。
      stream.getTracks().forEach((t) => t.stop());
    }
    await this.ctx.close();
  }
}

function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}
