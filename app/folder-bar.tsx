'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { Folder } from '@/lib/types';

import { ConfirmButton } from './confirm-button';
import styles from './folder-bar.module.css';

/** 一覧で選んでいるフォルダ。all はすべて、none は未分類。 */
export type FolderFilter = 'all' | 'none' | string;

type Props = {
  folders: (Folder & { count: number })[];
  total: number;
  unfiled: number;
  current: FolderFilter;
};

async function send(url: string, method: string, body?: unknown): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(error ?? `status ${res.status}`);
  }
  return res;
}

/**
 * 一覧の上に並べるフォルダのタブと、作成・名前変更・削除の操作。
 *
 * 選択中のフォルダは URL（?folder=）に持たせる。再読み込みしても、
 * 会議ページから戻っても同じフォルダが開いたままになる。
 */
export function FolderBar({ folders, total, unfiled, current }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<'create' | 'rename' | null>(null);
  const selected = folders.find((f) => f.id === current);

  return (
    <div className={styles.bar}>
      <nav className={styles.tabs}>
        <Tab href="/" active={current === 'all'} label="すべて" count={total} />
        {folders.map((f) => (
          <Tab
            key={f.id}
            href={`/?folder=${f.id}`}
            active={current === f.id}
            label={f.name}
            count={f.count}
          />
        ))}
        {/* 未分類はフォルダを作ってから意味を持つ。作る前は「すべて」と同じなので出さない */}
        {folders.length > 0 && (
          <Tab href="/?folder=none" active={current === 'none'} label="未分類" count={unfiled} />
        )}
        {editing !== 'create' && (
          <button className={styles.add} onClick={() => setEditing('create')}>
            ＋ フォルダ
          </button>
        )}
      </nav>

      {editing === 'create' && (
        <NameForm
          submitLabel="作成"
          onCancel={() => setEditing(null)}
          onSubmit={async (name) => {
            const res = await send('/api/folders', 'POST', { name });
            const folder = (await res.json()) as Folder;
            setEditing(null);
            router.push(`/?folder=${folder.id}`);
          }}
        />
      )}

      {selected && editing === 'rename' && (
        <NameForm
          initial={selected.name}
          submitLabel="変更"
          onCancel={() => setEditing(null)}
          onSubmit={async (name) => {
            await send(`/api/folders/${selected.id}`, 'PATCH', { name });
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      {selected && editing === null && (
        <div className={styles.folderActions}>
          <button className={styles.subtle} onClick={() => setEditing('rename')}>
            名前を変更
          </button>
          <ConfirmButton
            label="フォルダを削除"
            question="中の会議は消さずに未分類へ戻します"
            confirmLabel="削除する"
            busyLabel="削除中…"
            onConfirm={async () => {
              await send(`/api/folders/${selected.id}`, 'DELETE');
              router.push('/');
            }}
          />
        </div>
      )}
    </div>
  );
}

function Tab({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
}) {
  return (
    <Link href={href} className={styles.tab} data-active={active || undefined}>
      {label}
      <span className={styles.count}>{count}</span>
    </Link>
  );
}

/** フォルダ名の入力欄。作成と名前変更で共用する。 */
function NameForm({
  initial = '',
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className={styles.form}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSubmit(name);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          setBusy(false);
        }
      }}
    >
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        placeholder="フォルダ名（例: A社）"
        maxLength={40}
        autoFocus
      />
      <button type="submit" className="primary" disabled={busy || !name.trim()}>
        {submitLabel}
      </button>
      <button type="button" onClick={onCancel} disabled={busy}>
        やめる
      </button>
      {error && <p className={styles.error}>{error}</p>}
    </form>
  );
}
