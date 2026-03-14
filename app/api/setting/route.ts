import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getAllSettings } from '@/lib/setting/getters';
export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    const richPerms = await requireApiPermission(userId, 'setting', 'read');
    const items = await getAllSettings();
    // Filter to items the user can read (mirrors UI list page logic).
    const filtered = richPerms.general.read
      ? items
      : items.filter(item =>
          (richPerms.creator?.read && item.creator_id === userId) ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (richPerms.assignee?.read && (item as any).assignee_id === userId)
        );
    return NextResponse.json(filtered);
  } catch (error) {
    return handleApiError(error);
  }
}
