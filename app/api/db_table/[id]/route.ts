import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getDbTableDetail } from '@/lib/db_table/getters';
import { updateDbTable, deleteDbTable } from '@/lib/db_table/service';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'db_table', 'read');
    const item = await getDbTableDetail(id);
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
    await requireApiPermission(userId, 'db_table', 'update');
    const body = await request.json();
    const { name, description, fields } = body;
    const result = await updateDbTable(userId, id, name, description ?? null, fields ?? []);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'db_table', 'delete');
    await deleteDbTable([id]);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
