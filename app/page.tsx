import Link from 'next/link';

import { STATUS_LABEL, formatBytes, formatDateTime, formatDuration } from '@/lib/format';
import { MODE_LABEL } from '@/lib/types';
import { listMeetings } from '@/lib/server/store';

import { DeleteMeetingButton } from './delete-meeting-button';
import { NewMeetingButton } from './new-meeting-button';
import styles from './page.module.css';

// 会議は録音のたびに増えるので、一覧は常に最新をディスクから読む
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const meetings = await listMeetings();
  // 音声はすぐ嵩むので、消し時が分かるよう合計を出しておく
  const totalAudio = meetings.reduce((n, m) => n + m.audioBytes, 0);

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

      {meetings.length === 0 ? (
        <p className={styles.empty}>
          まだ会議がありません。「新しい会議」から録音を始めてください。
        </p>
      ) : (
        <ul className={styles.list}>
          {meetings.map((m) => (
            <li key={m.id} className={styles.row}>
              <Link href={`/meetings/${m.id}`} className={styles.item}>
                <span className={styles.title}>{m.title}</span>
                <span className={styles.meta}>
                  {formatDateTime(m.startedAt)}
                  {` ・ ${MODE_LABEL[m.mode]}`}
                  {m.durationSec > 0 && ` ・ ${formatDuration(m.durationSec)}`}
                  {m.audioBytes > 0 && ` ・ 音声 ${formatBytes(m.audioBytes)}`}
                </span>
                <span className={styles.status} data-status={m.status}>
                  {STATUS_LABEL[m.status]}
                </span>
              </Link>
              {/* Link の内側に置くとクリックが競合するので兄弟に並べる */}
              <div className={styles.rowActions}>
                <DeleteMeetingButton id={m.id} after="refresh" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
