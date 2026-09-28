import { heartbeat, releaseTab } from '@/lib/server/dev-shutdown';

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return new Response(null, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    closing?: boolean;
  };
  if (!body.id) return new Response(null, { status: 400 });

  if (body.closing) releaseTab(body.id);
  else heartbeat(body.id);

  return new Response(null, { status: 204 });
}
