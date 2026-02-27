import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getAllShifts } from '@/lib/shift/getters';
import { addShift } from '@/lib/shift/service';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'shift', 'read');
    const items = await getAllShifts();
    return NextResponse.json(items);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'shift', 'create');
    const body = await request.json();
    const { user_account_id: userAccountId, start_time: startTime, end_time: endTime, status } = body;
    const result = await addShift(userId, userAccountId, startTime, endTime, status);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
