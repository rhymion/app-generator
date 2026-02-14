import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getXxxxxXxxxxDetail } from '@/lib/xxxxx_xxxxx/getters';
import { updateXxxxxXxxxx, deleteXxxxxXxxxx } from '@/lib/xxxxx_xxxxx/service';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'xxxxx_xxxxx', 'read');
    const item = await getXxxxxXxxxxDetail(id);
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
    await requireApiPermission(userId, 'xxxxx_xxxxx', 'update');
    const body = await request.json();
    const { name, description, team, yyyyy_yyyyys } = body;
    const result = await updateXxxxxXxxxx(userId, id, name, description ?? null, team ?? null, yyyyy_yyyyys ?? []);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'xxxxx_xxxxx', 'delete');
    await deleteXxxxxXxxxx([id]);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
