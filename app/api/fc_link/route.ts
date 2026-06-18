import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getFcLinkPage } from '@/lib/fc_link/getters';
import { parsePageOpts } from '@/lib/_pagination';
export async function GET(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    const richPerms = await requireApiPermission(actorId, 'fc_link', 'read');
    const opts = parsePageOpts(request.nextUrl.searchParams);
    const result = await getFcLinkPage(opts, richPerms, actorId);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
