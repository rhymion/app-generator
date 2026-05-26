import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getPermissionPage } from '@/lib/permission/getters';
import { parsePageOpts } from '@/lib/_pagination';
import { addPermission } from '@/lib/permission/service';
export async function GET(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    const richPerms = await requireApiPermission(actorId, 'permission', 'read');
    const opts = parsePageOpts(request.nextUrl.searchParams);
    const result = await getPermissionPage(opts, richPerms, actorId);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    await requireApiPermission(actorId, 'permission', 'create');
    const body = await request.json();
    const { name, create, read, update, delete: deleteValue, role_id: roleId } = body;
    const result = await addPermission(actorId, name, create, read, update, deleteValue, roleId ?? null);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
