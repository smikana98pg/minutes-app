import path from 'node:path';

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

/**
 * 相対パスはプロジェクトルート起点に解決する。
 *
 * turbopackIgnore を付けているのは、動的な path.join(process.cwd(), ...) を
 * 見た Turbopack が「プロジェクト全体を出力に含める必要がある」と判断してしまうため。
 * このアプリはローカルでしか動かさないので、トレースは不要。
 */
function resolve(p: string): string {
  return path.isAbsolute(p) ? p : path.join(/* turbopackIgnore: true */ process.cwd(), p);
}

export const config = {
  whisperBin: env('WHISPER_BIN', '/opt/homebrew/bin/whisper-cli'),
  whisperModel: resolve(env('WHISPER_MODEL', './models/ggml-large-v3-turbo-q5_0.bin')),
  whisperThreads: env('WHISPER_THREADS', '6'),
  claudeBin: env('CLAUDE_BIN', 'claude'),
  claudeModel: env('CLAUDE_MODEL', 'opus'),
  dataDir: resolve(env('DATA_DIR', './data')),
};

export const meetingsDir = path.join(config.dataDir, 'meetings');
export const meetingDir = (id: string) => path.join(meetingsDir, id);
