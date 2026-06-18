import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import prisma from '@/lib/prisma';
import { getWorkDetail } from '@/lib/work/getters';
import { updateWork, deleteWork } from '@/lib/work/service';

type Params = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId: actorId } = await authenticateApiKey(request);
    const item = await getWorkDetail(id);
    if (!item) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await requireApiPermission(actorId, 'work', 'read', item);
    return NextResponse.json(item);
  } catch (error) {
    return handleApiError(error);
  }
}
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId: actorId } = await authenticateApiKey(request);
    const existing = await prisma.work.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await requireApiPermission(actorId, 'work', 'update', existing);
    const body = await request.json();
    const { title, pattern, status, characters_ids, scenes_ids } = body;
    await updateWork(actorId, id, title, pattern, status, characters_ids ?? [], scenes_ids ?? [], null);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId: actorId } = await authenticateApiKey(request);
    const existing = await prisma.work.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await requireApiPermission(actorId, 'work', 'delete', existing);
    await deleteWork([id]);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
