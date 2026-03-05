import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getAllSetting1s } from '@/lib/setting1/getters';
import { addSetting1 } from '@/lib/setting1/service';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'setting1', 'read');
    const items = await getAllSetting1s();
    return NextResponse.json(items);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'setting1', 'create');
    const body = await request.json();
    const { name, description, team, yyyyy_yyyyys } = body;
    const result = await addSetting1(userId, name, description ?? null, team ?? null, yyyyy_yyyyys ?? []);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
