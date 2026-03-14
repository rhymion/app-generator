import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getAllResources } from '@/lib/resource/getters';
import { addResource } from '@/lib/resource/service';
export async function GET(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    const richPerms = await requireApiPermission(userId, 'resource', 'read');
    const items = await getAllResources(userId);
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
    await requireApiPermission(userId, 'resource', 'create');
    const body = await request.json();
    const { name, description, organization_id: organizationId, resource_attachments, resource_images } = body;
    const result = await addResource(userId, name, description ?? null, organizationId, resource_attachments ?? [], resource_images ?? []);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
