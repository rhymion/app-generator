import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getParent1Detail } from '@/lib/parent1/getters';
import { updateParent1, deleteParent1 } from '@/lib/parent1/service';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'parent1', 'read');
    const item = await getParent1Detail(id);
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
    await requireApiPermission(userId, 'parent1', 'update');
    const body = await request.json();
    const { name, organization_id: organizationId, description, price, due_date: dueDate, image_url: imageUrl, parent1_child1s, parent1_child2s, parent1_lists } = body;
    const result = await updateParent1(id, name, organizationId, description ?? null, price, dueDate, imageUrl ?? null, parent1_child1s ?? [], parent1_child2s ?? [], parent1_lists ?? []);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'parent1', 'delete');
    await deleteParent1([id]);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
