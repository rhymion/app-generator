import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getAllParent1s } from '@/lib/parent1/getters';
import { addParent1 } from '@/lib/parent1/service';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'parent1', 'read');
    const items = await getAllParent1s();
    return NextResponse.json(items);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'parent1', 'create');
    const body = await request.json();
    const { name, organization_id, description, price, due_date, image_url, parent1_child1s, parent1_child2s, parent1_lists } = body;
    const result = await addParent1(userId, name, organization_id, description ?? null, price, due_date, image_url ?? null, parent1_child1s ?? [], parent1_child2s ?? [], parent1_lists ?? []);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
