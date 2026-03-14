import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getAllSetting1s } from '@/lib/setting1/getters';
import { addSetting1 } from '@/lib/setting1/service';
export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    const richPerms = await requireApiPermission(userId, 'setting1', 'read');
    const items = await getAllSetting1s();
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
    await requireApiPermission(userId, 'setting1', 'create');
    const body = await request.json();
    const { name, description, team, yyyyy_yyyyys } = body;
    const result = await addSetting1(userId, name, description ?? null, team ?? null, yyyyy_yyyyys ?? []);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
