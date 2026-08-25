'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { DeleteAudioButton } from '@/app/delete-audio-button';
import { DeleteMeetingButton } from '@/app/delete-meeting-button';
import { STATUS_LABEL, formatDateTime, formatDuration } from '@/lib/format';
import { MeetingRecorder, listAudioInputs } from '@/lib/client/recorder';
import { MODE_LABEL, type MeetingDetail, type MeetingMode } from '@/lib/types';

import styles from './meeting.module.css';

const POLL_INTERVAL_MS = 2000;

export function MeetingView({ initial }: { initial: MeetingDetail }) {
  const [detail, setDetail] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [recorder, setRecorder] = useState<MeetingRecorder | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const startedAt = useRef<number | null>(null);

  const isProcessing = detail.status === 'transcribing' || detail.status === 'summarizing';

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/meetings/${detail.id}`);
    if (res.ok) setDetail((await res.json()) as MeetingDetail);
  }, [detail.id]);

  // 処理中は進捗を見るためにポーリングする
  useEffect(() => {
    if (!isProcessing) return;
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isProcessing, refresh]);

  // 録音中の経過時間表示
  useEffect(() => {
    if (!recorder) return;
    const timer = setInterval(() => {
      if (startedAt.current !== null) {
        setElapsed((Date.now() - startedAt.current) / 1000);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [recorder]);

  // 録音中の誤操作でタブを閉じられないようにする
  useEffect(() => {
    if (!recorder) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [recorder]);

  async function startRecording(mode: MeetingMode, deviceId?: string) {
    setBusy(true);
    setNotice(null);
    try {
      const { recorder: rec, hasTabAudio } = await MeetingRecorder.start(
        detail.id,
        { mode, deviceId },
        {
          onLevel: setLevel,
          onWarning: setNotice,
          onDisplayEnded: () =>
            setNotice('画面共有が停止されました。マイクのみで録音を続けています。'),
        },
      );
      startedAt.current = Date.now();
      setRecorder(rec);
      setDetail((d) => ({ ...d, mode }));

      // どちらのモードで録ったかは議事録の生成時にも効くので記録しておく
      void fetch(`/api/meetings/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });

      if (mode === 'online' && !hasTabAudio) {
        setNotice(
          'タブの音声を取得できませんでした。マイクのみで録音しています。' +
            '相手の声も残すには、共有ダイアログで「タブ」を選び「タブの音声も共有」にチェックしてください。',
        );
      }
    } catch (e) {
      setNotice(
        `録音を開始できませんでした: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    try {
      await recorder?.stop();
      setRecorder(null);

      if (title.trim() && title !== detail.title) {
        await fetch(`/api/meetings/${detail.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        });
      }

      const res = await fetch(`/api/meetings/${detail.id}/finish`, { method: 'POST' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      await refresh();
    } catch (e) {
      setNotice(`終了処理に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setBusy(true);
    try {
      await fetch(`/api/meetings/${detail.id}/finish`, { method: 'POST' });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <Link href="/" className={styles.back}>
        ← 会議一覧
      </Link>

      {notice && <p className={styles.notice}>{notice}</p>}

      {detail.status === 'recording' && !recorder && (
        <Idle busy={busy} onStart={startRecording} />
      )}

      {detail.status === 'recording' && recorder && (
        <Recording
          mode={detail.mode}
          title={title}
          onTitleChange={setTitle}
          elapsed={elapsed}
          level={level}
          busy={busy}
          onFinish={finish}
        />
      )}

      {isProcessing && <Processing detail={detail} />}

      {detail.status === 'error' && (
        <section>
          <h1>{detail.title}</h1>
          <p className={styles.error}>{detail.error ?? '不明なエラーが発生しました'}</p>
          {detail.audioBytes > 0 ? (
            <button onClick={retry} disabled={busy}>
              {busy ? '再実行中…' : '同じ音声で再実行'}
            </button>
          ) : (
            <p className={styles.hint}>
              音声が残っていないため再実行できません。録り直してください。
            </p>
          )}
        </section>
      )}

      {detail.status === 'done' && <Done detail={detail} />}

      {/* 録音中は誤操作で消さないよう出さない */}
      {!recorder && (
        <footer className={styles.footer}>
          {/* 音声だけ消せるのは処理が終わっている会議に限る */}
          {detail.audioBytes > 0 &&
            (detail.status === 'done' || detail.status === 'error') && (
              <DeleteAudioButton
                id={detail.id}
                bytes={detail.audioBytes}
                onDeleted={refresh}
              />
            )}
          <DeleteMeetingButton id={detail.id} after="home" />
        </footer>
      )}
    </main>
  );
}

function Idle({
  busy,
  onStart,
}: {
  busy: boolean;
  onStart: (mode: MeetingMode, deviceId?: string) => void;
}) {
  const [mode, setMode] = useState<MeetingMode>('online');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>('');

  async function chooseMode(next: MeetingMode) {
    setMode(next);
    if (next !== 'inperson' || devices.length > 0) return;

    // マイクの名前は許可を出したあとにしか入らない。
    // 対面ではどのマイクで録るかが音質を決めるので、ここで一度許可を取って一覧を作る。
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((t) => t.stop());
      setDevices(await listAudioInputs());
    } catch {
      // 拒否されても既定のマイクで録音は試みられるので、ここでは何もしない
    }
  }

  return (
    <section>
      <h1>録音の準備</h1>

      <div className={styles.modes} role="group" aria-label="会議のとり方">
        <button
          className={styles.mode}
          data-active={mode === 'online'}
          onClick={() => chooseMode('online')}
        >
          <span className={styles.modeTitle}>オンライン会議</span>
          <span className={styles.modeDesc}>
            Google Meet や Zoom Web 版。マイクとタブの音声を合わせて録ります
          </span>
        </button>
        <button
          className={styles.mode}
          data-active={mode === 'inperson'}
          onClick={() => chooseMode('inperson')}
        >
          <span className={styles.modeTitle}>対面会議</span>
          <span className={styles.modeDesc}>
            同じ部屋での打ち合わせ。マイク1本で全員の声を拾います
          </span>
        </button>
      </div>

      {mode === 'online' ? (
        <ol className={styles.guide}>
          <li>会議のタブを先に開いておきます。</li>
          <li>下のボタンを押すとマイクの許可と画面共有のダイアログが順に出ます。</li>
          <li>
            共有ダイアログでは<strong>「タブ」を選び、「タブの音声も共有」にチェック</strong>
            してください。これが相手の声を残す唯一の経路です。
          </li>
        </ol>
      ) : (
        <>
          <ol className={styles.guide}>
            <li>画面共有は不要です。マイクの許可だけで始まります。</li>
            <li>
              端末を<strong>テーブルの中央に、話す人の方へ向けて</strong>置いてください。
              内蔵マイクが拾えるのは 1〜2m 程度が目安です。
            </li>
            <li>
              録音中はレベルメーターが動きます。
              奥の席の人が話したときに振れているか、最初に確かめてください。
            </li>
          </ol>

          {devices.length > 1 && (
            <label className={styles.label}>
              マイク
              <select
                className={styles.select}
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
              >
                <option value="">システムの既定</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || '名前のないマイク'}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}

      <button
        className="primary"
        onClick={() => onStart(mode, deviceId || undefined)}
        disabled={busy}
      >
        {busy ? '開始中…' : `${MODE_LABEL[mode]}の録音を開始`}
      </button>
      <p className={styles.hint}>
        音声はこのマシンの中だけで処理されます（文字起こしはローカルの Whisper）。
      </p>
    </section>
  );
}

function Recording({
  mode,
  title,
  onTitleChange,
  elapsed,
  level,
  busy,
  onFinish,
}: {
  mode: MeetingMode;
  title: string;
  onTitleChange: (v: string) => void;
  elapsed: number;
  level: number;
  busy: boolean;
  onFinish: () => void;
}) {
  return (
    <section>
      <div className={styles.recordingHead}>
        <span className={styles.dot} aria-hidden />
        <span className={styles.elapsed}>{formatDuration(elapsed)}</span>
        <span className={styles.recordingLabel}>録音中 ・ {MODE_LABEL[mode]}</span>
      </div>

      <div className={styles.meter} role="img" aria-label="入力レベル">
        {/* RMS は小さい値に偏るので、見た目のために増幅して頭打ちさせる */}
        <div className={styles.meterFill} style={{ width: `${Math.min(100, level * 300)}%` }} />
      </div>

      {mode === 'inperson' && (
        <p className={styles.hint}>
          奥の席の人が話したときにメーターが振れないときは、端末を近づけるか外部マイクを使ってください。
        </p>
      )}

      <label className={styles.label}>
        会議のタイトル
        <input
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="無題の会議"
        />
      </label>
      <p className={styles.hint}>
        空のままでも構いません。その場合は議事録の内容から自動で題名が付きます。
      </p>

      <button className="primary" onClick={onFinish} disabled={busy}>
        {busy ? '処理を開始しています…' : '会議を終了して議事録を作成'}
      </button>
    </section>
  );
}

function Processing({ detail }: { detail: MeetingDetail }) {
  const estimate = Math.max(1, Math.round((detail.durationSec / 60) * 0.14));
  return (
    <section>
      <h1>{detail.title}</h1>
      <p className={styles.processing}>
        <span className={styles.spinner} aria-hidden />
        {STATUS_LABEL[detail.status]}…
      </p>
      {detail.status === 'transcribing' && (
        <p className={styles.hint}>
          {formatDuration(detail.durationSec)} の音声を処理しています。
          目安はおよそ {estimate} 分です。このページは開いたままでも閉じても構いません。
        </p>
      )}
    </section>
  );
}

function Done({ detail }: { detail: MeetingDetail }) {
  const [copied, setCopied] = useState(false);
  const markdown = detail.minutesMarkdown ?? '';

  async function copy() {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function download() {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${detail.startedAt.slice(0, 10)}_${detail.title}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section>
      <h1>{detail.title}</h1>
      <p className={styles.sub}>
        {formatDateTime(detail.startedAt)} ・ {MODE_LABEL[detail.mode]} ・{' '}
        {formatDuration(detail.durationSec)}
      </p>

      <div className={styles.actions}>
        <button onClick={copy}>{copied ? 'コピーしました' : 'Markdown をコピー'}</button>
        <button onClick={download}>.md をダウンロード</button>
      </div>

      {detail.minutes ? (
        <>
          <h2>要約</h2>
          <p>{detail.minutes.summary}</p>

          <h2>決定事項</h2>
          {detail.minutes.decisions.length === 0 ? (
            <p className={styles.hint}>なし</p>
          ) : (
            <ul className={styles.decisions}>
              {detail.minutes.decisions.map((d, i) => (
                <li key={i}>
                  {d.text}
                  {d.context && <span className={styles.context}>{d.context}</span>}
                </li>
              ))}
            </ul>
          )}

          <h2>ToDo</h2>
          {detail.minutes.todos.length === 0 ? (
            <p className={styles.hint}>なし</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>担当</th>
                  <th>タスク</th>
                  <th>期限</th>
                </tr>
              </thead>
              <tbody>
                {detail.minutes.todos.map((t, i) => (
                  <tr key={i}>
                    <td>{t.assignee ?? '未定'}</td>
                    <td>{t.task}</td>
                    <td>{t.due ?? '未定'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {detail.minutes.openQuestions.length > 0 && (
            <>
              <h2>未解決の論点</h2>
              <ul>
                {detail.minutes.openQuestions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <>
          <h2>議事録</h2>
          <pre className={styles.pre}>{markdown}</pre>
        </>
      )}

      {detail.transcriptMarkdown && (
        <details className={styles.details}>
          <summary>文字起こし全文</summary>
          <pre className={styles.pre}>{detail.transcriptMarkdown}</pre>
        </details>
      )}
    </section>
  );
}
