/**
 * マイクとタブ音声のミックスを生 PCM として集め、メインスレッドへ渡す。
 *
 * MediaRecorder を使わないのは、webm チャンクの 2 個目以降が単体でデコードできず、
 * stop/start を繰り返すと境界で音が欠けるため。ここで Float32 を素通しすれば
 * 欠落がなく、whisper が要求する 16kHz / mono へそのまま落とせる。
 */
const BUFFER_SIZE = 4096; // 128 サンプルごとに postMessage すると多すぎるのでまとめる

class PcmCollector extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(BUFFER_SIZE);
    this._offset = 0;
  }

  process(inputs) {
    // channelCountMode を explicit / channelCount を 1 にしてあるので、
    // 複数ソースはここに来る時点でモノラルに合成済み。
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      this._buffer[this._offset++] = channel[i];
      if (this._offset === BUFFER_SIZE) {
        // process() の入力バッファは使い回されるのでコピーして渡す
        this.port.postMessage(this._buffer.slice(0));
        this._offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-collector', PcmCollector);
