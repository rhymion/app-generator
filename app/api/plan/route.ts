import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getPlanPage } from '@/lib/plan/getters';
import { parsePageOpts } from '@/lib/_pagination';
import { addPlan } from '@/lib/plan/service';
export async function GET(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    const richPerms = await requireApiPermission(actorId, 'plan', 'read');
    const opts = parsePageOpts(request.nextUrl.searchParams);
    const result = await getPlanPage(opts, richPerms, actorId);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    await requireApiPermission(actorId, 'plan', 'create');
    const body = await request.json();
    const { tier, reaction_kinds_allowed: reactionKindsAllowed, sub_account_limit: subAccountLimit, can_view_paid_posts: canViewPaidPosts, users_ids } = body;
    const result = await addPlan(actorId, tier, reactionKindsAllowed, subAccountLimit, canViewPaidPosts, users_ids ?? []);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
