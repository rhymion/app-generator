import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getMusicPage } from '@/lib/music/getters';
import { parsePageOpts } from '@/lib/_pagination';
import { addMusic } from '@/lib/music/service';
export async function GET(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    const richPerms = await requireApiPermission(actorId, 'music', 'read');
    const opts = parsePageOpts(request.nextUrl.searchParams);
    const result = await getMusicPage(opts, richPerms, actorId);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    await requireApiPermission(actorId, 'music', 'create');
    const body = await request.json();
    const { title, kind, scenes_ids, composers_ids, credits_ids } = body;
    const result = await addMusic(actorId, title, kind, scenes_ids ?? [], composers_ids ?? [], credits_ids ?? []);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
