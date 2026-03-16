// AUTO-GENERATED - DO NOT EDIT
import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import prisma from '@/lib/prisma';
import { addShift } from '@/lib/shift/service';
import { updateShift, deleteShift } from '@/lib/shift/service';

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
// POST /api/shift/bulk  — bulk create
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'shift', 'create');
    const body = await request.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bulkItems: any[] = Array.isArray(body) ? body : [body];
    const results: BulkResult<{ id: string }>[] = [];

    for (let i = 0; i < bulkItems.length; i++) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { user_account_id: userAccountId, start_time: startTime, end_time: endTime, status } = bulkItems[i] as any;
        const result = await addShift(userId, userAccountId, startTime, endTime, status);
        results.push({ index: i, success: true, data: result });
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
// PUT /api/shift/bulk  — bulk update
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
        const { id, user_account_id: userAccountId, start_time: startTime, end_time: endTime, status } = bulkItems[i] as any;
        const existing = await prisma.shift.findUnique({ where: { id }, select: { creator_id: true } });
        if (!existing) {
          results.push({ index: i, success: false, error: `Not found: ${id}` });
          continue;
        }
        await requireApiPermission(userId, 'shift', 'update', existing);
        await updateShift(userId, id, userAccountId, startTime, endTime, status, null);
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
// DELETE /api/shift/bulk  — bulk delete
// ---------------------------------------------------------------------------
export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    const body = await request.json();
    const bulkItems: { id: string }[] = Array.isArray(body) ? body : [body];
    const results: BulkResult<null>[] = [];

    for (let i = 0; i < bulkItems.length; i++) {
      try {
        const { id } = bulkItems[i];
        const existing = await prisma.shift.findUnique({ where: { id }, select: { creator_id: true } });
        if (!existing) {
          results.push({ index: i, success: false, error: `Not found: ${id}` });
          continue;
        }
        await requireApiPermission(userId, 'shift', 'delete', existing);
        await deleteShift([id]);
        results.push({ index: i, success: true, data: null });
      } catch (err) {
        results.push({ index: i, success: false, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return NextResponse.json(makeBulkResponse(results), { status: 207 });
  } catch (error) {
    return handleApiError(error);
  }
}
