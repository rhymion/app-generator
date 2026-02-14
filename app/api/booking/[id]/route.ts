import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getBookingDetail } from '@/lib/booking/getters';
import { updateBooking, deleteBooking } from '@/lib/booking/service';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'booking', 'read');
    const item = await getBookingDetail(id);
    if (!item) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(item);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'booking', 'update');
    const body = await request.json();
    const { name, resource_id: resourceId, start_time: startTime, end_time: endTime } = body;
    const result = await updateBooking(userId, id, name, resourceId, startTime, endTime);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'booking', 'delete');
    await deleteBooking([id]);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
