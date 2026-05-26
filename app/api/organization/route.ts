import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getOrganizationPage } from '@/lib/organization/getters';
import { parsePageOpts } from '@/lib/_pagination';
import { addOrganization } from '@/lib/organization/service';
export async function GET(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    const richPerms = await requireApiPermission(actorId, 'organization', 'read');
    const opts = parsePageOpts(request.nextUrl.searchParams);
    const result = await getOrganizationPage(opts, richPerms, actorId);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    await requireApiPermission(actorId, 'organization', 'create');
    const body = await request.json();
    const { name, description, users_ids } = body;
    const result = await addOrganization(actorId, name, description ?? null, users_ids ?? []);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
