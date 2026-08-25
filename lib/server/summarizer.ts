import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { MeetingMeta, Minutes } from '@/lib/types';

import { config } from './config';

/**
 * 議事録の生成手段。今は Claude Code CLI を定額枠で叩く実装だけだが、
 * 将来 API キー方式（Anthropic SDK）に差し替えられるようここで切っておく。
 */
export interface Summarizer {
  generate(transcript: string, meta: MeetingMeta): Promise<SummarizeResult>;
}

export type SummarizeResult =
  | { ok: true; minutes: Minutes }
  /** JSON として読めなかった場合。議事録を失うよりは生テキストを残す。 */
  | { ok: false; raw: string };

const SYSTEM_PROMPT = `あなたは会議の文字起こしから議事録を生成する専用ツールです。出力は JSON のみです。

## 出力スキーマ

以下のキーだけを持つ JSON オブジェクトを1つ出力します。**スキーマに無いキーを追加してはいけません。**

{
  "title": string,            // 会議の内容を表す簡潔な題名
  "summary": string,          // 会議全体の要約。3〜6文の日本語の文章
  "decisions": [              // 会議で決まったこと。決まっていなければ空配列
    { "text": string, "context": string }
  ],
  "todos": [                  // 次のアクション。なければ空配列
    { "task": string, "assignee": string | null, "due": string | null }
  ],
  "openQuestions": [ string ] // 未解決のまま持ち越された論点。なければ空配列
}

## 規則

- 出力は上記の JSON オブジェクト1つだけ。前後に説明文を書かない。
- \`decisions[].context\` は、その決定に至った背景を1文で。不要なら空文字列。
- \`todos[].assignee\` は文字起こしに担当者が明示されている場合のみ名前を入れ、無ければ null。
- \`todos[].due\` は与えられた会議日を基準に相対表現を解決し \`YYYY-MM-DD\` 形式にする。判断できなければ null。
- 文字起こしは音声認識の出力なので同音異義語の誤りを含む。文脈から明らかな誤変換は正しい語に直して記述する。
- 文字起こしに書かれていない事実を創作しない。曖昧な点は openQuestions に入れる。
- すべて日本語で記述する。`;

function buildPrompt(transcript: string, meta: MeetingMeta, retry: boolean): string {
  const started = new Date(meta.startedAt);
  const weekday = '日月火水木金土'[started.getDay()];
  const date = `${started.getFullYear()}-${String(started.getMonth() + 1).padStart(2, '0')}-${String(started.getDate()).padStart(2, '0')}`;
  const time = started.toTimeString().slice(0, 5);
  const mins = Math.round(meta.durationSec / 60);

  // 録り方によって文字起こしの性質が違うので、読み方の前提を渡す
  const nature =
    meta.mode === 'inperson'
      ? [
          '- 収録: 対面会議を1本のマイクで収録',
          '',
          'この文字起こしは話者が区別されておらず、複数人の発言が連続して並んでいます。',
          '誰の発言かは文脈から推測し、確信が持てない担当者は null にしてください。',
          'マイクから遠い席の発言は認識精度が落ちている可能性があります。',
        ]
      : ['- 収録: オンライン会議（マイクとタブ音声を合成）'];

  return [
    '# 会議情報',
    '',
    `- タイトル: ${meta.title}`,
    `- 日時: ${date} (${weekday}) ${time}`,
    `- 長さ: ${mins}分`,
    ...nature,
    '',
    '# 文字起こし',
    '',
    transcript,
    '',
    '# 指示',
    '',
    '上記の文字起こしから議事録を作成し、スキーマどおりの JSON のみを出力してください。',
    ...(retry
      ? [
          '',
          '**重要**: 前回の出力は JSON として解釈できませんでした。',
          'コードフェンスも説明文も付けず、`{` で始まり `}` で終わる JSON だけを出力してください。',
        ]
      : []),
  ].join('\n');
}

/** claude -p --output-format json が返す封筒のうち、こちらが読む部分。 */
type CliEnvelope = {
  is_error: boolean;
  subtype?: string;
  result?: string;
};

async function runClaude(prompt: string): Promise<string> {
  // プロジェクトの CLAUDE.md が自動で読み込まれてプロンプトに混ざらないよう、
  // 空のディレクトリを cwd にして実行する。
  // なお --bare は使えない。認証が ANTHROPIC_API_KEY 限定になり OAuth を読まなくなるため、
  // 定額枠で動かすというこのアプリの前提が崩れる。
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'minutes-claude-'));

  const child = spawn(
    config.claudeBin,
    [
      '-p',
      '--output-format', 'json',
      '--model', config.claudeModel,
      '--system-prompt', SYSTEM_PROMPT,
      '--disallowed-tools', 'Bash,Read,Write,Edit,WebSearch,WebFetch,Glob,Grep,Task,TodoWrite',
    ],
    { cwd, stdio: ['pipe', 'pipe', 'pipe'] },
  );

  // 文字起こしは長くなるため argv ではなく stdin から渡す。
  // argv だと macOS の上限（約 1MB）に近づく。
  child.stdin.end(prompt, 'utf8');

  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (c: Buffer) => stdout.push(c));
  child.stderr.on('data', (c: Buffer) => stderr.push(c));

  const code: number = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });

  const out = Buffer.concat(stdout).toString('utf8');
  if (code !== 0) {
    throw new Error(
      `claude の終了コードが ${code} でした: ${Buffer.concat(stderr).toString('utf8').slice(0, 500)}`,
    );
  }

  const envelope = JSON.parse(out) as CliEnvelope;
  if (envelope.is_error || typeof envelope.result !== 'string') {
    throw new Error(`claude がエラーを返しました (${envelope.subtype ?? 'unknown'})`);
  }
  return envelope.result;
}

/** ```json フェンスや前後の説明文が付いていても JSON 本体を取り出す。 */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenced) return fenced[1].trim();

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) return text.slice(start, end + 1);

  return text.trim();
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function nullableStr(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** モデルの出力を Minutes に正規化する。型が違う要素は落とす。 */
function normalize(parsed: unknown): Minutes | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.summary !== 'string') return null; // 要約が無いものは議事録として扱わない

  return {
    title: str(o.title),
    summary: o.summary,
    decisions: Array.isArray(o.decisions)
      ? o.decisions
          .map((d) => {
            const r = d as Record<string, unknown>;
            return { text: str(r?.text), context: str(r?.context) };
          })
          .filter((d) => d.text.length > 0)
      : [],
    todos: Array.isArray(o.todos)
      ? o.todos
          .map((t) => {
            const r = t as Record<string, unknown>;
            return {
              task: str(r?.task),
              assignee: nullableStr(r?.assignee),
              due: nullableStr(r?.due),
            };
          })
          .filter((t) => t.task.length > 0)
      : [],
    openQuestions: Array.isArray(o.openQuestions)
      ? o.openQuestions.filter((q): q is string => typeof q === 'string' && q.length > 0)
      : [],
  };
}

export class ClaudeCliSummarizer implements Summarizer {
  async generate(transcript: string, meta: MeetingMeta): Promise<SummarizeResult> {
    let lastRaw = '';

    // CLI 経由には structured outputs のような保証がないので、
    // パースに失敗したら1回だけ「JSON だけを返せ」と添えて再試行する。
    for (const retry of [false, true]) {
      lastRaw = await runClaude(buildPrompt(transcript, meta, retry));
      try {
        const minutes = normalize(JSON.parse(extractJson(lastRaw)));
        if (minutes) return { ok: true, minutes };
      } catch {
        // 次のループで再試行する
      }
    }

    return { ok: false, raw: lastRaw };
  }
}
