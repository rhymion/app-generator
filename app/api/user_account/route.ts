import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getAllUserAccounts } from '@/lib/user_account/getters';
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
