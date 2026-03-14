import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getAllShiftTemplates } from '@/lib/shift_template/getters';
import { addShiftTemplate } from '@/lib/shift_template/service';
export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    const richPerms = await requireApiPermission(userId, 'shift_template', 'read');
    const items = await getAllShiftTemplates();
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
export async function POST(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'shift_template', 'create');
    const body = await request.json();
    const { user_account_id: userAccountId, day_of_week: dayOfWeek, start_time: startTime, end_time: endTime } = body;
    const result = await addShiftTemplate(userId, userAccountId, dayOfWeek, startTime, endTime);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
