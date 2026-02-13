import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getAllParentOnlys } from '@/lib/parent_only/getters';
import { addParentOnly } from '@/lib/parent_only/service';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'parent_only', 'read');
    const items = await getAllParentOnlys();
    return NextResponse.json(items);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'parent_only', 'create');
    const body = await request.json();
    const { name, description, login_time: loginTime, logout_time: logoutTime } = body;
    const result = await addParentOnly(userId, name, description ?? null, loginTime ?? null, logoutTime ?? null);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
