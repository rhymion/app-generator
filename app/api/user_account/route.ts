import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getAllUserAccounts } from '@/lib/user_account/getters';
import { addUserAccount } from '@/lib/user_account/service';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'user_account', 'read');
    const items = await getAllUserAccounts();
    return NextResponse.json(items);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'user_account', 'create');
    const body = await request.json();
    const { name, email, password, api_key, avatar, roles_ids } = body;
    const result = await addUserAccount(userId, name, email, password, api_key ?? null, avatar ?? null, roles_ids ?? []);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
