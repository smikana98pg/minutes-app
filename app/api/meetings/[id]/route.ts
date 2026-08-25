import { deleteMeeting, readMeetingDetail, updateMeta } from '@/lib/server/store';
import type { MeetingMeta, MeetingMode } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    return Response.json(await readMeetingDetail(id));
  } catch {
    return Response.json({ error: '会議が見つかりません' }, { status: 404 });
  }
}

/** 録音開始時のモード確定と、録音中のタイトル変更に使う。 */
export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    mode?: MeetingMode;
  };

  const patch: Partial<MeetingMeta> = {};
  if (typeof body.title === 'string') patch.title = body.title.trim() || '無題の会議';
  if (body.mode === 'online' || body.mode === 'inperson') patch.mode = body.mode;

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: 'title か mode が必要です' }, { status: 400 });
  }

  try {
    return Response.json(await updateMeta(id, patch));
  } catch {
    return Response.json({ error: '会議が見つかりません' }, { status: 404 });
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    await deleteMeeting(id);
    return new Response(null, { status: 204 });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
