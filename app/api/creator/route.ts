import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getCreatorPage } from '@/lib/creator/getters';
import { parsePageOpts } from '@/lib/_pagination';
import { addCreator } from '@/lib/creator/service';
export async function GET(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    const richPerms = await requireApiPermission(actorId, 'creator', 'read');
    const opts = parsePageOpts(request.nextUrl.searchParams);
    const result = await getCreatorPage(opts, richPerms, actorId);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    await requireApiPermission(actorId, 'creator', 'create');
    const body = await request.json();
    const { name, role, affiliation, voicedCharacters_ids, composedMusics_ids, creditedMusics_ids, creditedScenes_ids } = body;
    const result = await addCreator(actorId, name, role, affiliation, voicedCharacters_ids ?? [], composedMusics_ids ?? [], creditedMusics_ids ?? [], creditedScenes_ids ?? []);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
