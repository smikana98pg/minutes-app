'use client';

import { useState } from 'react';

import styles from './confirm-button.module.css';

/**
 * 押すと自分自身が確認状態に変わるボタン。
 *
 * window.confirm を使わないのは、ネイティブのダイアログだと
 * 「どれに対する操作なのか」が画面から消えてしまうため。
 */
export function ConfirmButton({
  label,
  question,
  confirmLabel,
  busyLabel,
  onConfirm,
}: {
  label: string;
  /** 確認状態で並べて出す一言。何が失われるかを書く。 */
  question: string;
  confirmLabel: string;
  busyLabel: string;
  onConfirm: () => Promise<void>;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      await onConfirm();
      // 対象が消えてこのボタン自体が外れることが多いが、
      // 残る場合に確認状態のまま固まらないよう畳んでおく。
      setBusy(false);
      setArmed(false);
    } catch (e) {
      alert(`実行できませんでした: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
      setArmed(false);
    }
  }

  if (!armed) {
    return (
      <button className={styles.trigger} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }

  return (
    <span className={styles.confirm}>
      <span className={styles.question}>{question}</span>
      <button className={styles.danger} onClick={run} disabled={busy}>
        {busy ? busyLabel : confirmLabel}
      </button>
      <button onClick={() => setArmed(false)} disabled={busy}>
        やめる
      </button>
    </span>
  );
}
