import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getChannelPage } from '@/lib/channel/getters';
import { parsePageOpts } from '@/lib/_pagination';
export async function GET(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    const richPerms = await requireApiPermission(actorId, 'channel', 'read');
    const opts = parsePageOpts(request.nextUrl.searchParams);
    const result = await getChannelPage(opts, richPerms, actorId);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
