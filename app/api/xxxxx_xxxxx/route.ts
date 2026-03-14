import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getAllXxxxxXxxxxs } from '@/lib/xxxxx_xxxxx/getters';
import { addXxxxxXxxxx } from '@/lib/xxxxx_xxxxx/service';
export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    const richPerms = await requireApiPermission(userId, 'xxxxx_xxxxx', 'read');
    const items = await getAllXxxxxXxxxxs();
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
    await requireApiPermission(userId, 'xxxxx_xxxxx', 'create');
    const body = await request.json();
    const { name, description, team, yyyyy_yyyyys } = body;
    const result = await addXxxxxXxxxx(userId, name, description ?? null, team ?? null, yyyyy_yyyyys ?? []);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
