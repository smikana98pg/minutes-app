/** 会議の処理状態。パイプラインはこの順に進む。 */
export type MeetingStatus =
  | 'recording'
  | 'transcribing'
  | 'summarizing'
  | 'done'
  | 'error';

/**
 * 録音のとり方。音声の取得経路もマイクの設定も変わる。
 * - online: マイク＋ブラウザのタブ音声。相手の声はスピーカーではなくタブから直接取る
 * - inperson: マイクのみ。部屋全体を1本で拾う
 */
export type MeetingMode = 'online' | 'inperson';

export const MODE_LABEL: Record<MeetingMode, string> = {
  online: 'オンライン会議',
  inperson: '対面会議',
};

/**
 * 何の場か。議事録の構成が変わる（面接は QA を立てる）。録り方の mode とは独立。
 */
export type MeetingKind = 'meeting' | 'interview';

/** 一覧や見出しに出す「オンライン会議」「対面面接」などの呼び名。 */
export function recordingLabel(kind: MeetingKind, mode: MeetingMode): string {
  if (kind === 'interview') return mode === 'online' ? 'オンライン面接' : '対面面接';
  return MODE_LABEL[mode];
}

export type MeetingMeta = {
  id: string;
  title: string;
  mode: MeetingMode;
  kind: MeetingKind;
  status: MeetingStatus;
  startedAt: string;
  endedAt: string | null;
  /** 収録した音声の長さ（秒）。PCM のバイト数から算出する。 */
  durationSec: number;
  /** status が 'error' のときの理由。 */
  error: string | null;
  /** 議事録が JSON としてパースできず生テキストで保存された場合に立つ。 */
  rawFallback?: boolean;
  /** 入っているフォルダ。未分類なら無し（null）。フォルダ導入前の会議にはキー自体が無い。 */
  folderId?: string | null;
};

/** 会議をまとめるフォルダ（「A社」「B社」など）。入れ子にはしない。 */
export type Folder = {
  id: string;
  name: string;
  createdAt: string;
};

export type Todo = {
  task: string;
  assignee: string | null;
  due: string | null;
};

export type Decision = {
  text: string;
  context?: string;
};

/** 面接でのやり取り 1 往復。 */
export type QA = {
  q: string;
  a: string;
};

/** claude -p に生成させる議事録の構造。 */
export type Minutes = {
  title: string;
  summary: string;
  decisions: Decision[];
  /** 面接のときだけ入る。会議の議事録には無い。 */
  qa?: QA[];
  todos: Todo[];
  openQuestions: string[];
};

/** whisper-cli が -oj で吐く JSON のうち、必要な部分だけ。 */
export type TranscriptSegment = {
  /** 開始・終了のミリ秒。 */
  startMs: number;
  endMs: number;
  text: string;
};

/** 一覧の 1 行。音声の占有量はディスクから都度測る（meta には持たせない）。 */
export type MeetingListItem = MeetingMeta & { audioBytes: number };

/** 会議詳細画面が使う、meta と成果物をまとめたもの。 */
export type MeetingDetail = MeetingMeta & {
  minutes: Minutes | null;
  minutesMarkdown: string | null;
  transcriptMarkdown: string | null;
  /** 会議ディレクトリに手で置いた notes.md。無ければ null。 */
  notesMarkdown: string | null;
  /** audio.pcm と audio.wav の合計バイト数。0 なら音声は削除済み。 */
  audioBytes: number;
};

/** 音声フォーマット。whisper が要求する 16kHz / mono / 16bit に固定する。 */
export const SAMPLE_RATE = 16000;
export const CHANNELS = 1;
export const BYTES_PER_SAMPLE = 2;
