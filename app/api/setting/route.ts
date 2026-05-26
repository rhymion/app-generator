import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getSettingPage } from '@/lib/setting/getters';
import { parsePageOpts } from '@/lib/_pagination';
export async function GET(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    const richPerms = await requireApiPermission(actorId, 'setting', 'read');
    const opts = parsePageOpts(request.nextUrl.searchParams);
    const result = await getSettingPage(opts, richPerms, actorId);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
