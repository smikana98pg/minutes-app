'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { MeetingMeta } from '@/lib/types';

export function NewMeetingButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const meeting = (await res.json()) as MeetingMeta;
      // 録音の開始はこのあと会議ページのボタンから行う。
      // getDisplayMedia はユーザー操作の中でしか呼べず、
      // 画面遷移を挟むと AudioContext ごと作り直しになるため。
      router.push(`/meetings/${meeting.id}`);
    } catch (e) {
      alert(`会議を作成できませんでした: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  }

  return (
    <button className="primary" onClick={create} disabled={busy}>
      {busy ? '準備中…' : '新しい会議'}
    </button>
  );
}
