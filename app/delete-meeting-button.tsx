'use client';

import { useRouter } from 'next/navigation';

import { ConfirmButton } from './confirm-button';

/** 会議をディレクトリごと削除する。音声も議事録も戻せない。 */
export function DeleteMeetingButton({
  id,
  after,
}: {
  id: string;
  /** 削除後の遷移先。一覧なら再読み込み、詳細ページなら一覧へ戻る。 */
  after: 'refresh' | 'home';
}) {
  const router = useRouter();

  return (
    <ConfirmButton
      label="会議を削除"
      question="音声も議事録も消します"
      confirmLabel="削除する"
      busyLabel="削除中…"
      onConfirm={async () => {
        const res = await fetch(`/api/meetings/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`status ${res.status}`);
        if (after === 'home') router.push('/');
        else router.refresh();
      }}
    />
  );
}
