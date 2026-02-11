import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getAllPermissions } from '@/lib/permission/getters';
import { addPermission } from '@/lib/permission/service';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'permission', 'read');
    const items = await getAllPermissions();
    return NextResponse.json(items);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'permission', 'create');
    const body = await request.json();
    const { name, create, read, update, delete, role_id } = body;
    const result = await addPermission(userId, name, create, read, update, delete, role_id ?? null);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
