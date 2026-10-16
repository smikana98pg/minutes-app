import Link from 'next/link';

import { STATUS_LABEL, formatBytes, formatDateTime, formatDuration } from '@/lib/format';
import { recordingLabel } from '@/lib/types';
import { listFolders, listMeetings } from '@/lib/server/store';

import { DeleteMeetingButton } from './delete-meeting-button';
import { FolderBar, type FolderFilter } from './folder-bar';
import { MoveToFolder } from './move-to-folder';
import { NewMeetingButton } from './new-meeting-button';
import styles from './page.module.css';

// 会議は録音のたびに増えるので、一覧は常に最新をディスクから読む
export const dynamic = 'force-dynamic';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [all, folders, params] = await Promise.all([listMeetings(), listFolders(), searchParams]);
  // 音声はすぐ嵩むので、消し時が分かるよう合計を出しておく
  const totalAudio = all.reduce((n, m) => n + m.audioBytes, 0);

  // 消えたフォルダを指したままの会議は未分類として扱う
  const folderNames = new Map(folders.map((f) => [f.id, f.name]));
  const folderOf = (m: { folderId?: string | null }) =>
    m.folderId && folderNames.has(m.folderId) ? m.folderId : null;

  const requested = typeof params.folder === 'string' ? params.folder : 'all';
  // 削除済みのフォルダの URL を開いたときは「すべて」に戻す
  const current: FolderFilter =
    requested === 'none' || folderNames.has(requested) ? requested : 'all';

  const meetings = all.filter((m) =>
    current === 'all' ? true : current === 'none' ? folderOf(m) === null : folderOf(m) === current,
  );

  return (
    <main>
      <header className={styles.header}>
        <div>
          <h1>議事録</h1>
          <p className={styles.sub}>
            会議の音声から議事録を自動生成します
            {totalAudio > 0 && (
              <>
                <br />
                音声が {formatBytes(totalAudio)} 分たまっています。議事録が出た会議は、
                会議ページから音声だけ消せます。
              </>
            )}
          </p>
        </div>
        <NewMeetingButton />
      </header>

      <FolderBar
        folders={folders.map((f) => ({ ...f, count: all.filter((m) => folderOf(m) === f.id).length }))}
        total={all.length}
        unfiled={all.filter((m) => folderOf(m) === null).length}
        current={current}
      />

      {meetings.length === 0 ? (
        <p className={styles.empty}>
          {all.length === 0
            ? 'まだ会議がありません。「新しい会議」から録音を始めてください。'
            : 'このフォルダにはまだ会議がありません。「すべて」の一覧で、各行の「フォルダ」から移せます。'}
        </p>
      ) : (
        <ul className={styles.list}>
          {meetings.map((m) => (
            <li key={m.id} className={styles.row}>
              <Link href={`/meetings/${m.id}`} className={styles.item}>
                <span className={styles.title}>{m.title}</span>
                <span className={styles.meta}>
                  {formatDateTime(m.startedAt)}
                  {/* フォルダで絞り込んでいるときは自明なので出さない */}
                  {current === 'all' && folderOf(m) && ` ・ ${folderNames.get(folderOf(m)!)}`}
                  {` ・ ${recordingLabel(m.kind, m.mode)}`}
                  {m.durationSec > 0 && ` ・ ${formatDuration(m.durationSec)}`}
                  {m.audioBytes > 0 && ` ・ 音声 ${formatBytes(m.audioBytes)}`}
                </span>
                <span className={styles.status} data-status={m.status}>
                  {STATUS_LABEL[m.status]}
                </span>
              </Link>
              {/* Link の内側に置くとクリックが競合するので兄弟に並べる */}
              <div className={styles.rowActions}>
                {folders.length > 0 && (
                  <MoveToFolder id={m.id} folderId={folderOf(m)} folders={folders} />
                )}
                <DeleteMeetingButton id={m.id} after="refresh" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
