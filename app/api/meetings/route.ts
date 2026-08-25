import { createMeeting, listMeetings } from '@/lib/server/store';

export async function GET() {
  return Response.json(await listMeetings());
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { title?: string };
  return Response.json(await createMeeting(body.title), { status: 201 });
}
