import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getAllProcedures } from '@/lib/procedure/getters';
import { addProcedure } from '@/lib/procedure/service';
export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    const richPerms = await requireApiPermission(userId, 'procedure', 'read');
    const items = await getAllProcedures();
    // Filter to items the user can read (mirrors UI list page logic).
    const filtered = richPerms.general.read
      ? items
      : items.filter(item =>
          (richPerms.creator?.read && item.creator_id === userId) ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (richPerms.assignee?.read && (item as any).assignee_id === userId)
        );
    return NextResponse.json(filtered);
  } catch (error) {
    return handleApiError(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'procedure', 'create');
    const body = await request.json();
    const { name, description, parent_id: parentId, assignee_id: assigneeId, children_ids, precededBy_ids, followedBy_ids } = body;
    const result = await addProcedure(userId, name, description ?? null, parentId ?? null, assigneeId ?? null, children_ids ?? [], precededBy_ids ?? [], followedBy_ids ?? []);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
