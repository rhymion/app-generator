import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { addSetting8 } from '@/lib/setting8/service';

export async function POST(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'setting8', 'create');
    const body = await request.json();
    const { name, description } = body;
    const result = await addSetting8(userId, name, description ?? null);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
