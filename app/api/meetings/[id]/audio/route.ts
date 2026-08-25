import { deleteAudio, readMeta } from '@/lib/server/store';

type Ctx = { params: Promise<{ id: string }> };

/**
 * 議事録と文字起こしを残したまま音声だけ消す。
 *
 * 処理中に消すと文字起こしの入力が消えるので、終わっている会議に限る。
 */
export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;

  let meta;
  try {
    meta = await readMeta(id);
  } catch {
    return Response.json({ error: '会議が見つかりません' }, { status: 404 });
  }

  if (meta.status !== 'done' && meta.status !== 'error') {
    return Response.json(
      { error: '処理中の会議の音声は削除できません' },
      { status: 409 },
    );
  }

  await deleteAudio(id);
  return new Response(null, { status: 204 });
}
