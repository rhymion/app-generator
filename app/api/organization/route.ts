import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getAllOrganizations } from '@/lib/organization/getters';
import { addOrganization } from '@/lib/organization/service';
export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'organization', 'read');
    const items = await getAllOrganizations();
    return NextResponse.json(items);
  } catch (error) {
    return handleApiError(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'organization', 'create');
    const body = await request.json();
    const { name, description, userAccounts_ids } = body;
    const result = await addOrganization(userId, name, description ?? null, userAccounts_ids ?? []);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
