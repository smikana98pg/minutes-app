import { FolderError, deleteFolder, renameFolder } from '@/lib/server/store';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  try {
    return Response.json(await renameFolder(id, body.name));
  } catch (e) {
    if (e instanceof FolderError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

/** フォルダだけを消す。中の会議は未分類に戻る。 */
export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    await deleteFolder(id);
    return new Response(null, { status: 204 });
  } catch (e) {
    if (e instanceof FolderError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
