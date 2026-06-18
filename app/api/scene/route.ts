import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getScenePage } from '@/lib/scene/getters';
import { parsePageOpts } from '@/lib/_pagination';
import { addScene } from '@/lib/scene/service';
export async function GET(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    const richPerms = await requireApiPermission(actorId, 'scene', 'read');
    const opts = parsePageOpts(request.nextUrl.searchParams);
    const result = await getScenePage(opts, richPerms, actorId);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    await requireApiPermission(actorId, 'scene', 'create');
    const body = await request.json();
    const { label, work_id: workId, episode, timestamp, characters_ids, music_ids, creators_ids } = body;
    const result = await addScene(actorId, label, workId, episode, timestamp, characters_ids ?? [], music_ids ?? [], creators_ids ?? []);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
