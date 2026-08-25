import { runPipeline } from '@/lib/server/pipeline';
import { currentDurationSec, readMeta, updateMeta } from '@/lib/server/store';

type Ctx = { params: Promise<{ id: string }> };

/**
 * 会議を終了して処理パイプラインを起動する。
 * status が 'error' の会議に対して呼ぶと、同じ音声のまま再実行する。
 */
export async function POST(_request: Request, { params }: Ctx) {
  const { id } = await params;

  let meta;
  try {
    meta = await readMeta(id);
  } catch {
    return Response.json({ error: '会議が見つかりません' }, { status: 404 });
  }

  if (meta.status === 'transcribing' || meta.status === 'summarizing') {
    return Response.json(meta); // 二重送信。既に走っている
  }
  if (meta.status === 'done') {
    return Response.json({ error: '既に完了しています' }, { status: 409 });
  }

  const updated = await updateMeta(id, {
    endedAt: meta.endedAt ?? new Date().toISOString(),
    durationSec: await currentDurationSec(id),
    status: 'transcribing',
    error: null,
  });

  // 文字起こしは分単位でかかるのでリクエストは待たせない。
  // クライアントは GET /api/meetings/[id] をポーリングして進捗を見る。
  void runPipeline(id);

  return Response.json(updated);
}
