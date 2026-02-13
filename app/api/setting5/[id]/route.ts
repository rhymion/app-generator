import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getSetting5Detail } from '@/lib/setting5/getters';
import { updateSetting5 } from '@/lib/setting5/service';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'user_account', 'read');
    const item = await getSetting5Detail(id);
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
    const { name, email } = body;
    const result = await updateSetting5(id, name, email);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
