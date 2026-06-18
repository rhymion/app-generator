import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import prisma from '@/lib/prisma';
import { getDashboardDetail } from '@/lib/dashboard/getters';
import { updateDashboard, deleteDashboard } from '@/lib/dashboard/service';

type Params = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId: actorId } = await authenticateApiKey(request);
    const item = await getDashboardDetail(id);
    if (!item) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await requireApiPermission(actorId, 'dashboard', 'read', item);
    return NextResponse.json(item);
  } catch (error) {
    return handleApiError(error);
  }
}
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId: actorId } = await authenticateApiKey(request);
    const existing = await prisma.dashboard.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await requireApiPermission(actorId, 'dashboard', 'update', existing);
    const body = await request.json();
    const { name, widgets } = body;
    await updateDashboard(actorId, id, name, widgets ?? [], null);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId: actorId } = await authenticateApiKey(request);
    const existing = await prisma.dashboard.findUnique({ where: { id }, select: { id: true, creator_id: true } });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await requireApiPermission(actorId, 'dashboard', 'delete', existing);
    await deleteDashboard([id]);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
