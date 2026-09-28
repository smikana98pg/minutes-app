/**
 * 開発時だけ、このタブが生きていることを開発サーバーに知らせる。
 * タブを閉じると `pagehide` の beacon が飛び、生きているタブが無くなった時点で
 * サーバー側が `next dev` を停止する（判定は lib/server/dev-shutdown.ts）。
 */
if (process.env.NODE_ENV === 'development') {
  const ENDPOINT = '/api/dev/heartbeat';
  const PING_MS = 30_000;
  const id = crypto.randomUUID();

  const ping = () => {
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
      keepalive: true,
    }).catch(() => {
      // サーバーが既に落ちている場合は何もしない
    });
  };

  const release = () => {
    const payload = new Blob([JSON.stringify({ id, closing: true })], {
      type: 'application/json',
    });
    navigator.sendBeacon(ENDPOINT, payload);
  };

  ping();
  // バックグラウンドのタブではタイマーが間引かれるが、サーバー側の失効判定を
  // 十分長く取ってあるので問題ない
  setInterval(ping, PING_MS);

  window.addEventListener('pagehide', release);
  // bfcache から復帰したときは再登録する
  window.addEventListener('pageshow', ping);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ping();
  });
}
