import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getWorkPage } from '@/lib/work/getters';
import { parsePageOpts } from '@/lib/_pagination';
import { addWork } from '@/lib/work/service';
export async function GET(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    const richPerms = await requireApiPermission(actorId, 'work', 'read');
    const opts = parsePageOpts(request.nextUrl.searchParams);
    const result = await getWorkPage(opts, richPerms, actorId);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    await requireApiPermission(actorId, 'work', 'create');
    const body = await request.json();
    const { title, pattern, status, characters_ids, scenes_ids } = body;
    const result = await addWork(actorId, title, pattern, status, characters_ids ?? [], scenes_ids ?? []);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
