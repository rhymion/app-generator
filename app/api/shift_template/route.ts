import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getAllShiftTemplates } from '@/lib/shift_template/getters';
import { addShiftTemplate } from '@/lib/shift_template/service';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'shift_template', 'read');
    const items = await getAllShiftTemplates();
    return NextResponse.json(items);
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
