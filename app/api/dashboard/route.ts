import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { getDashboardPage } from '@/lib/dashboard/getters';
import { parsePageOpts } from '@/lib/_pagination';
import { addDashboard } from '@/lib/dashboard/service';
export async function GET(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    const richPerms = await requireApiPermission(actorId, 'dashboard', 'read');
    const opts = parsePageOpts(request.nextUrl.searchParams);
    const result = await getDashboardPage(opts, richPerms, actorId);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    await requireApiPermission(actorId, 'dashboard', 'create');
    const body = await request.json();
    const { name, widgets } = body;
    const result = await addDashboard(actorId, name, widgets ?? []);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
