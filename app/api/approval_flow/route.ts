import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getApprovalFlowPage } from '@/lib/approval_flow/getters';
import { parsePageOpts } from '@/lib/_pagination';
import { addApprovalFlow } from '@/lib/approval_flow/service';
export async function GET(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    const richPerms = await requireApiPermission(actorId, 'approval_flow', 'read');
    const opts = parsePageOpts(request.nextUrl.searchParams);
    const result = await getApprovalFlowPage(opts, richPerms, actorId);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    await requireApiPermission(actorId, 'approval_flow', 'create');
    const body = await request.json();
    const { entity_name: entityName, requestor_role_id: requestorRoleId, approver_role_id: approverRoleId, precededBy_ids, followedBy_ids } = body;
    const result = await addApprovalFlow(actorId, entityName, requestorRoleId ?? null, approverRoleId, precededBy_ids ?? [], followedBy_ids ?? []);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
