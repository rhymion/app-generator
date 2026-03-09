import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getAllRoles } from '@/lib/role/getters';
import { addRole } from '@/lib/role/service';
export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'role', 'read');
    const items = await getAllRoles();
    return NextResponse.json(items);
  } catch (error) {
    return handleApiError(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'role', 'create');
    const body = await request.json();
    const { name, description, userAccounts_ids } = body;
    const result = await addRole(userId, name, description ?? null, userAccounts_ids ?? []);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
