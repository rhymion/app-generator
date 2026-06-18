import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getCharacterPage } from '@/lib/character/getters';
import { parsePageOpts } from '@/lib/_pagination';
import { addCharacter } from '@/lib/character/service';
export async function GET(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    const richPerms = await requireApiPermission(actorId, 'character', 'read');
    const opts = parsePageOpts(request.nextUrl.searchParams);
    const result = await getCharacterPage(opts, richPerms, actorId);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    await requireApiPermission(actorId, 'character', 'create');
    const body = await request.json();
    const { name, work_id: workId, official_image: officialImage, scenes_ids, creators_ids } = body;
    const result = await addCharacter(actorId, name, workId, officialImage, scenes_ids ?? [], creators_ids ?? []);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
