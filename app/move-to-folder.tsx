'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { Folder } from '@/lib/types';

/** 一覧の行から会議を別のフォルダへ移す。 */
export function MoveToFolder({
  id,
  folderId,
  folders,
}: {
  id: string;
  folderId: string | null;
  folders: Folder[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function move(next: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/meetings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: next || null }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      router.refresh();
    } catch (e) {
      alert(`移動できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      aria-label="フォルダ"
      title="フォルダを移動"
      value={folderId ?? ''}
      disabled={busy}
      onChange={(e) => void move(e.target.value)}
    >
      <option value="">未分類</option>
      {folders.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </select>
  );
}
