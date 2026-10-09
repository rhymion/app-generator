import { NextRequest, NextResponse } from 'next/server';
import { authenticate, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getAuditLogPage } from '@/lib/audit_log/getters';
import { parsePageOpts } from '@/lib/_pagination';
export async function GET(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticate(request);
    const richPerms = await requireApiPermission(actorId, 'audit_log', 'read');
    const opts = parsePageOpts(request.nextUrl.searchParams);
    const result = await getAuditLogPage(opts, richPerms, actorId);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
