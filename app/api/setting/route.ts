import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getAllSettings } from '@/lib/setting/getters';
export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'setting', 'read');
    const items = await getAllSettings();
    return NextResponse.json(items);
  } catch (error) {
    return handleApiError(error);
  }
}
