import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import prisma from '@/lib/prisma';
import { getSceneDetail } from '@/lib/scene/getters';
import { updateScene, deleteScene } from '@/lib/scene/service';

type Params = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId: actorId } = await authenticateApiKey(request);
    const item = await getSceneDetail(id);
    if (!item) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await requireApiPermission(actorId, 'scene', 'read', item);
    return NextResponse.json(item);
  } catch (error) {
    return handleApiError(error);
  }
}
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId: actorId } = await authenticateApiKey(request);
    const existing = await prisma.scene.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await requireApiPermission(actorId, 'scene', 'update', existing);
    const body = await request.json();
    const { label, work_id: workId, episode, timestamp, characters_ids, music_ids, creators_ids } = body;
    await updateScene(actorId, id, label, workId, episode, timestamp, characters_ids ?? [], music_ids ?? [], creators_ids ?? [], null);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId: actorId } = await authenticateApiKey(request);
    const existing = await prisma.scene.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await requireApiPermission(actorId, 'scene', 'delete', existing);
    await deleteScene([id]);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
