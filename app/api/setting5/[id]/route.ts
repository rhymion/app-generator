import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import prisma from '@/lib/prisma';
import { getSetting5Detail } from '@/lib/setting5/getters';
import { updateSetting5 } from '@/lib/setting5/service';

type Params = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId } = await authenticateApiKey(request);
    const item = await getSetting5Detail(id);
    if (!item) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await requireApiPermission(userId, 'setting5', 'read', item);
    return NextResponse.json(item);
  } catch (error) {
    return handleApiError(error);
  }
}
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId } = await authenticateApiKey(request);
    const existing = await prisma.xxxxx_xxxxx.findUnique({ where: { id }, select: { creator_id: true } });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await requireApiPermission(userId, 'setting5', 'update', existing);
    const body = await request.json();
    const { name, yyyyy_yyyyys } = body;
    const result = await updateSetting5(userId, id, name, yyyyy_yyyyys ?? [], null);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
