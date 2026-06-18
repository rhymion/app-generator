import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getRolePage } from '@/lib/role/getters';
import { parsePageOpts } from '@/lib/_pagination';
import { addRole } from '@/lib/role/service';
export async function GET(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    const richPerms = await requireApiPermission(actorId, 'role', 'read');
    const opts = parsePageOpts(request.nextUrl.searchParams);
    const result = await getRolePage(opts, richPerms, actorId);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    await requireApiPermission(actorId, 'role', 'create');
    const body = await request.json();
    const { name, description, users_ids } = body;
    const result = await addRole(actorId, name, description ?? null, users_ids ?? []);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
