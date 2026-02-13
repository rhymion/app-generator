import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getAllSetting1s } from '@/lib/setting1/getters';
import { addSetting1 } from '@/lib/setting1/service';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'user_account', 'read');
    const items = await getAllSetting1s();
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
    const { name, email, password, api_key: apiKey, avatar } = body;
    const result = await addSetting1(userId, name, email, password, apiKey ?? null, avatar ?? null);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
