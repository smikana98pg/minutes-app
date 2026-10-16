import { FolderError, createFolder, listFolders } from '@/lib/server/store';

export async function GET() {
  return Response.json(await listFolders());
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  try {
    return Response.json(await createFolder(body.name), { status: 201 });
  } catch (e) {
    if (e instanceof FolderError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
