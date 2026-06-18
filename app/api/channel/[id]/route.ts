import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import prisma from '@/lib/prisma';
import { getChannelDetail } from '@/lib/channel/getters';
import { updateChannel, deleteChannel } from '@/lib/channel/service';

type Params = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId: actorId } = await authenticateApiKey(request);
    const item = await getChannelDetail(id, actorId);
    if (!item) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await requireApiPermission(actorId, 'channel', 'read', item);
    return NextResponse.json(item);
  } catch (error) {
    return handleApiError(error);
  }
}
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId: actorId } = await authenticateApiKey(request);
    const existing = await prisma.channel.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await requireApiPermission(actorId, 'channel', 'update', existing);
    const body = await request.json();
    const { name, kind, organization_id: organizationId, selectedParentType, selectedParentId } = body;
    await updateChannel(actorId, id, name, kind, organizationId, null);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId: actorId } = await authenticateApiKey(request);
    const existing = await prisma.channel.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await requireApiPermission(actorId, 'channel', 'delete', existing);
    await deleteChannel([id]);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
