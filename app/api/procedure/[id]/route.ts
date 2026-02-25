import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import prisma from '@/lib/prisma';
import { getProcedureDetail } from '@/lib/procedure/getters';
import { updateProcedure, deleteProcedure } from '@/lib/procedure/service';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId } = await authenticateApiKey(request);
    const item = await getProcedureDetail(id);
    if (!item) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await requireApiPermission(userId, 'procedure', 'read', item);
    return NextResponse.json(item);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId } = await authenticateApiKey(request);
    const existing = await prisma.procedure.findUnique({ where: { id }, select: { creator_id: true, assignee_id: true } });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await requireApiPermission(userId, 'procedure', 'update', existing);
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
    const existing = await prisma.procedure.findUnique({ where: { id }, select: { creator_id: true, assignee_id: true } });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await requireApiPermission(userId, 'procedure', 'delete', existing);
    await deleteProcedure([id]);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
