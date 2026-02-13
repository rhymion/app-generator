import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getAllBookings } from '@/lib/booking/getters';
import { addBooking } from '@/lib/booking/service';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'booking', 'read');
    const items = await getAllBookings();
    return NextResponse.json(items);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'booking', 'create');
    const body = await request.json();
    const { name, resource_id: resourceId, start_time: startTime, end_time: endTime } = body;
    const result = await addBooking(userId, name, resourceId, startTime, endTime);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
