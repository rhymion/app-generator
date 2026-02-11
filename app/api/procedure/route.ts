import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getAllProcedures } from '@/lib/procedure/getters';
import { addProcedure } from '@/lib/procedure/service';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'procedure', 'read');
    const items = await getAllProcedures();
    return NextResponse.json(items);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'procedure', 'create');
    const body = await request.json();
    const { name, description, parent_id, children_ids, precededBy_ids, followedBy_ids } = body;
    const result = await addProcedure(userId, name, description ?? null, parent_id ?? null, children_ids ?? [], precededBy_ids ?? [], followedBy_ids ?? []);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
