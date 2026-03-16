// AUTO-GENERATED - DO NOT EDIT
import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import prisma from '@/lib/prisma';
import { updateSetting } from '@/lib/setting/service';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

type BulkSuccess<T> = { index: number; success: true; data: T };
type BulkFailure  = { index: number; success: false; error: string };
type BulkResult<T> = BulkSuccess<T> | BulkFailure;

interface BulkResponse<T> {
  results: BulkResult<T>[];
  summary: { total: number; succeeded: number; failed: number };
}

function makeBulkResponse<T>(results: BulkResult<T>[]): BulkResponse<T> {
  return {
    results,
    summary: {
      total:     results.length,
      succeeded: results.filter((r) =>  r.success).length,
      failed:    results.filter((r) => !r.success).length,
    },
  };
}

// ---------------------------------------------------------------------------
// POST /api/setting/bulk  — bulk create
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PUT /api/setting/bulk  — bulk update
// ---------------------------------------------------------------------------
export async function PUT(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    const body = await request.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bulkItems: any[] = Array.isArray(body) ? body : [body];
    const results: BulkResult<{ success: boolean }>[] = [];

    for (let i = 0; i < bulkItems.length; i++) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { id, name, email, password, api_key: apiKey, avatar, roles_ids } = bulkItems[i] as any;
        const existing = await prisma.user_account.findUnique({ where: { id }, select: { creator_id: true } });
        if (!existing) {
          results.push({ index: i, success: false, error: `Not found: ${id}` });
          continue;
        }
        await requireApiPermission(userId, 'setting', 'update', existing);
        await updateSetting(userId, id, name, email, password, apiKey ?? null, avatar ?? null, roles_ids ?? [], null);
        results.push({ index: i, success: true, data: { success: true } });
      } catch (err) {
        results.push({ index: i, success: false, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return NextResponse.json(makeBulkResponse(results), { status: 207 });
  } catch (error) {
    return handleApiError(error);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/setting/bulk  — bulk delete
// ---------------------------------------------------------------------------
