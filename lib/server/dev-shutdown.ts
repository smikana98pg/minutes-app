import { execFileSync } from 'node:child_process';

/**
 * 開発サーバーをブラウザのタブに追従させて停止させるための状態管理。
 *
 * ブラウザのタブが閉じられると `pagehide` の beacon が届き、そのタブを外す。
 * 生きているタブが 0 になってから GRACE_MS 経っても復帰しなければ `next dev` を止める。
 * 猶予を挟むのは、リロードや別ページへの遷移でも `pagehide` が飛ぶため。
 *
 * PING_MS のハートビートは beacon が届かなかったとき（ブラウザの強制終了など）の保険で、
 * バックグラウンドのタブはタイマーが 1 分程度まで間引かれるので STALE_MS は十分長く取る。
 */

const PING_MS = 30_000;
const STALE_MS = 5 * 60_000;
const GRACE_MS = 10_000;
const SWEEP_MS = 1_000;

type DevShutdownState = {
  tabs: Map<string, number>;
  emptySince: number | null;
  armed: boolean;
  timer: NodeJS.Timeout | null;
};

const globalRef = globalThis as typeof globalThis & {
  __minutesDevShutdown?: DevShutdownState;
};

function getState(): DevShutdownState {
  globalRef.__minutesDevShutdown ??= {
    tabs: new Map(),
    emptySince: null,
    armed: false,
    timer: null,
  };
  return globalRef.__minutesDevShutdown;
}

export const heartbeatIntervalMs = PING_MS;

export function heartbeat(id: string) {
  const state = getState();
  state.armed = true;
  state.emptySince = null;
  state.tabs.set(id, Date.now());
  ensureSweeper(state);
}

export function releaseTab(id: string) {
  const state = getState();
  state.tabs.delete(id);
  if (state.armed && state.tabs.size === 0) {
    state.emptySince ??= Date.now();
  }
  ensureSweeper(state);
}

function ensureSweeper(state: DevShutdownState) {
  if (state.timer) return;
  state.timer = setInterval(() => sweep(), SWEEP_MS);
  // サーバーを生かし続ける理由にはしない
  state.timer.unref?.();
}

function sweep() {
  const state = getState();
  const now = Date.now();

  for (const [id, lastSeen] of state.tabs) {
    if (now - lastSeen > STALE_MS) state.tabs.delete(id);
  }

  if (!state.armed) return;

  if (state.tabs.size > 0) {
    state.emptySince = null;
    return;
  }

  state.emptySince ??= now;
  if (now - state.emptySince >= GRACE_MS) shutdown(state);
}

function shutdown(state: DevShutdownState) {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  state.armed = false;

  console.log('\n[dev-shutdown] ブラウザのタブが閉じられたため開発サーバーを停止します。');

  // ルートハンドラが動くのは next-server ワーカー。自分だけ落としても親の
  // `next dev` がポートを掴んだまま残るので、親が next なら先に止める。
  const parent = process.ppid;
  setTimeout(() => {
    if (parent > 1 && isNextProcess(parent)) {
      try {
        process.kill(parent, 'SIGTERM');
      } catch {
        // 既に終了していれば無視
      }
    }
    process.exit(0);
  }, 50);
}

function isNextProcess(pid: number) {
  try {
    const command = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], {
      encoding: 'utf8',
    });
    return command.includes('next');
  } catch {
    return false;
  }
}
