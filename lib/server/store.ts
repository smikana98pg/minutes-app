import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { MeetingDetail, MeetingListItem, MeetingMeta, Minutes } from '@/lib/types';

import { meetingDir, meetingsDir } from './config';
import { pcmDurationSec } from './wav';

/**
 * 会議は DB ではなくディレクトリで持つ。
 * 件数はせいぜい年数百件で、一覧はディレクトリを読むだけで足りるうえ、
 * 「保存 = Markdown を書く」で Markdown 出力の要件も同時に満たせる。
 */
export const files = {
  meta: (id: string) => path.join(meetingDir(id), 'meta.json'),
  pcm: (id: string) => path.join(meetingDir(id), 'audio.pcm'),
  wav: (id: string) => path.join(meetingDir(id), 'audio.wav'),
  transcriptJson: (id: string) => path.join(meetingDir(id), 'transcript.json'),
  transcriptMd: (id: string) => path.join(meetingDir(id), 'transcript.md'),
  minutesJson: (id: string) => path.join(meetingDir(id), 'minutes.json'),
  minutesMd: (id: string) => path.join(meetingDir(id), 'minutes.md'),
  /** 自動生成ではなく、あとから人が書き足すメモ。 */
  notesMd: (id: string) => path.join(meetingDir(id), 'notes.md'),
};

/** id にパス区切りなどが混ざっていないことを保証する（ディレクトリ traversal 対策）。 */
function assertSafeId(id: string): void {
  if (!/^[0-9a-zA-Z_-]+$/.test(id)) throw new Error(`不正な会議 ID: ${id}`);
}

export async function createMeeting(title?: string): Promise<MeetingMeta> {
  const id = `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
  await mkdir(meetingDir(id), { recursive: true });

  const meta: MeetingMeta = {
    id,
    title: title?.trim() || '無題の会議',
    // 実際のモードは録音開始時に確定する（PATCH で上書きされる）
    mode: 'online',
    status: 'recording',
    startedAt: new Date().toISOString(),
    endedAt: null,
    durationSec: 0,
    error: null,
  };
  await writeMeta(meta);
  // 追記先を先に作っておく。チャンクが 1 つも来なかった場合の分岐を減らせる。
  await writeFile(files.pcm(id), Buffer.alloc(0));
  return meta;
}

export async function readMeta(id: string): Promise<MeetingMeta> {
  assertSafeId(id);
  const meta = JSON.parse(await readFile(files.meta(id), 'utf8')) as MeetingMeta;
  // mode を導入する前に録った会議はすべてオンライン会議だった
  return { ...meta, mode: meta.mode ?? 'online' };
}

export async function writeMeta(meta: MeetingMeta): Promise<void> {
  assertSafeId(meta.id);
  await writeFile(files.meta(meta.id), JSON.stringify(meta, null, 2));
}

export async function updateMeta(
  id: string,
  patch: Partial<MeetingMeta>,
): Promise<MeetingMeta> {
  const next = { ...(await readMeta(id)), ...patch };
  await writeMeta(next);
  return next;
}

/** 録音チャンク（生 PCM）を追記する。 */
export async function appendPcm(id: string, data: Buffer): Promise<void> {
  assertSafeId(id);
  await appendFile(files.pcm(id), data);
}

/** これまでに書き込まれた PCM から現在の収録秒数を求める。 */
export async function currentDurationSec(id: string): Promise<number> {
  assertSafeId(id);
  try {
    return pcmDurationSec((await stat(files.pcm(id))).size);
  } catch {
    return 0;
  }
}

/** audio.pcm と audio.wav の合計バイト数。無ければ 0。 */
export async function audioBytes(id: string): Promise<number> {
  assertSafeId(id);
  const sizes = await Promise.all(
    [files.pcm(id), files.wav(id)].map(async (p) => {
      try {
        return (await stat(p)).size;
      } catch {
        return 0;
      }
    }),
  );
  return sizes.reduce((a, b) => a + b, 0);
}

/**
 * 議事録と文字起こしを残したまま、音声だけを消す。
 * 1 時間の会議で約 230MB を占めるので、済んだものから消せるようにしてある。
 */
export async function deleteAudio(id: string): Promise<void> {
  assertSafeId(id);
  await Promise.all([
    rm(files.pcm(id), { force: true }),
    rm(files.wav(id), { force: true }),
  ]);
}

export async function listMeetings(): Promise<MeetingListItem[]> {
  let entries: string[];
  try {
    entries = await readdir(meetingsDir);
  } catch {
    return []; // 1 件も録っていない状態
  }

  const metas = await Promise.all(
    entries.map(async (id) => {
      try {
        return { ...(await readMeta(id)), audioBytes: await audioBytes(id) };
      } catch {
        return null; // 壊れた・作りかけのディレクトリは黙って飛ばす
      }
    }),
  );

  return metas
    .filter((m): m is MeetingListItem => m !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/**
 * 会議をディレクトリごと消す。音声・文字起こし・議事録がすべて失われる。
 *
 * 処理中の会議に対して呼ばれることもあるが、pipeline 側は書き込み失敗を
 * まとめて捕まえているので、走っている処理は静かに終わる。
 */
export async function deleteMeeting(id: string): Promise<void> {
  assertSafeId(id);
  await rm(meetingDir(id), { recursive: true, force: true });
}

async function readIfExists(p: string): Promise<string | null> {
  try {
    return await readFile(p, 'utf8');
  } catch {
    return null;
  }
}

/** 会議詳細画面向けに meta と成果物をまとめて返す。 */
export async function readMeetingDetail(id: string): Promise<MeetingDetail> {
  const meta = await readMeta(id);
  const [minutesRaw, minutesMarkdown, transcriptMarkdown, notesMarkdown, bytes] =
    await Promise.all([
      readIfExists(files.minutesJson(id)),
      readIfExists(files.minutesMd(id)),
      readIfExists(files.transcriptMd(id)),
      readIfExists(files.notesMd(id)),
      audioBytes(id),
    ]);

  let minutes: Minutes | null = null;
  if (minutesRaw) {
    try {
      minutes = JSON.parse(minutesRaw) as Minutes;
    } catch {
      minutes = null; // 生テキストへフォールバックした回。minutesMarkdown だけ表示する
    }
  }

  return {
    ...meta,
    minutes,
    minutesMarkdown,
    transcriptMarkdown,
    notesMarkdown,
    audioBytes: bytes,
  };
}
