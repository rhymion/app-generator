import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getAllDbTables } from '@/lib/db_table/getters';
import { addDbTable } from '@/lib/db_table/service';
export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'db_table', 'read');
    const items = await getAllDbTables();
    return NextResponse.json(items);
  } catch (error) {
    return handleApiError(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'db_table', 'create');
    const body = await request.json();
    const { name, description, fields } = body;
    const result = await addDbTable(userId, name, description ?? null, fields ?? []);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
