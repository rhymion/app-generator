import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import prisma from '@/lib/prisma';
import { getCharacterDetail } from '@/lib/character/getters';
import { updateCharacter, deleteCharacter } from '@/lib/character/service';

type Params = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId: actorId } = await authenticateApiKey(request);
    const item = await getCharacterDetail(id);
    if (!item) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await requireApiPermission(actorId, 'character', 'read', item);
    return NextResponse.json(item);
  } catch (error) {
    return handleApiError(error);
  }
}
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId: actorId } = await authenticateApiKey(request);
    const existing = await prisma.character.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await requireApiPermission(actorId, 'character', 'update', existing);
    const body = await request.json();
    const { name, work_id: workId, official_image: officialImage, scenes_ids, creators_ids } = body;
    await updateCharacter(actorId, id, name, workId, officialImage, scenes_ids ?? [], creators_ids ?? [], null);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId: actorId } = await authenticateApiKey(request);
    const existing = await prisma.character.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await requireApiPermission(actorId, 'character', 'delete', existing);
    await deleteCharacter([id]);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
