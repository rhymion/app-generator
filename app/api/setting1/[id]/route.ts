import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getSetting1Detail } from '@/lib/setting1/getters';
import { updateSetting1, deleteSetting1 } from '@/lib/setting1/service';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'user_account', 'read');
    const item = await getSetting1Detail(id);
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
    const { name, email, password, api_key: apiKey, avatar } = body;
    const result = await updateSetting1(id, name, email, password, apiKey ?? null, avatar ?? null);
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
    await deleteSetting1([id]);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
