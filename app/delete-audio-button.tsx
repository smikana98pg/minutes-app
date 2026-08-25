'use client';

import { formatBytes } from '@/lib/format';

import { ConfirmButton } from './confirm-button';

/**
 * 議事録と文字起こしを残したまま、音声ファイルだけを消す。
 * 1 時間の会議で約 230MB あるので、済んだ会議から消していくとディスクが空く。
 */
export function DeleteAudioButton({
  id,
  bytes,
  onDeleted,
}: {
  id: string;
  bytes: number;
  /**
   * 削除後に呼ぶ。router.refresh() では駄目で、置き場所が親の state だから。
   * 会議ページは detail を useState で持っており、サーバー側を再描画しても
   * 初期値として渡した prop は state に反映されない。
   */
  onDeleted: () => Promise<void>;
}) {
  return (
    <ConfirmButton
      label={`音声を削除（${formatBytes(bytes)}）`}
      question="議事録と文字起こしは残ります"
      confirmLabel="音声を削除"
      busyLabel="削除中…"
      onConfirm={async () => {
        const res = await fetch(`/api/meetings/${id}/audio`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`status ${res.status}`);
        await onDeleted();
      }}
    />
  );
}
