import { appendPcm, currentDurationSec } from '@/lib/server/store';

type Ctx = { params: Promise<{ id: string }> };

/**
 * 録音チャンク（16kHz / mono / s16le の生 PCM）を受け取って追記する。
 * 30 秒ぶんで約 960KB。
 */
export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  const body = Buffer.from(await request.arrayBuffer());
  if (body.length === 0) return Response.json({ ok: true, durationSec: 0 });

  try {
    await appendPcm(id, body);
    return Response.json({ ok: true, durationSec: await currentDurationSec(id) });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
