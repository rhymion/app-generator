import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getProcedureDetail } from '@/lib/procedure/getters';
import { updateProcedure, deleteProcedure } from '@/lib/procedure/service';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'procedure', 'read');
    const item = await getProcedureDetail(id);
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
    await requireApiPermission(userId, 'procedure', 'update');
    const body = await request.json();
    const { name, description, parent_id: parentId, assignee_id: assigneeId, children_ids, precededBy_ids, followedBy_ids } = body;
    const result = await updateProcedure(userId, id, name, description ?? null, parentId ?? null, assigneeId ?? null, children_ids ?? [], precededBy_ids ?? [], followedBy_ids ?? []);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'procedure', 'delete');
    await deleteProcedure([id]);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
