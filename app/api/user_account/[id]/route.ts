import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getUserAccountDetail } from '@/lib/user_account/getters';
import { updateUserAccount, deleteUserAccount } from '@/lib/user_account/service';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'user_account', 'read');
    const item = await getUserAccountDetail(id);
    if (!item) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(item);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'user_account', 'update');
    const body = await request.json();
    const { name, email, password, api_key: apiKey, avatar, roles_ids } = body;
    const result = await updateUserAccount(userId, id, name, email, password, apiKey ?? null, avatar ?? null, roles_ids ?? []);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'user_account', 'delete');
    await deleteUserAccount([id]);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
