// AUTO-GENERATED - DO NOT EDIT
import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import prisma from '@/lib/prisma';
import { addParentOnly } from '@/lib/parent_only/service';
import { updateParentOnly, deleteParentOnly } from '@/lib/parent_only/service';

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
// POST /api/parent_only/bulk  — bulk create
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'parent_only', 'create');
    const body = await request.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bulkItems: any[] = Array.isArray(body) ? body : [body];
    const results: BulkResult<{ id: string }>[] = [];

    for (let i = 0; i < bulkItems.length; i++) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { name, description, login_time: loginTime, logout_time: logoutTime } = bulkItems[i] as any;
        const result = await addParentOnly(userId, name, description ?? null, loginTime ?? null, logoutTime ?? null);
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
// PUT /api/parent_only/bulk  — bulk update
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
        const { id, name, description, login_time: loginTime, logout_time: logoutTime } = bulkItems[i] as any;
        const existing = await prisma.parent_only.findUnique({ where: { id }, select: { creator_id: true } });
        if (!existing) {
          results.push({ index: i, success: false, error: `Not found: ${id}` });
          continue;
        }
        await requireApiPermission(userId, 'parent_only', 'update', existing);
        await updateParentOnly(userId, id, name, description ?? null, loginTime ?? null, logoutTime ?? null, null);
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
// DELETE /api/parent_only/bulk  — bulk delete
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
        const existing = await prisma.parent_only.findUnique({ where: { id }, select: { creator_id: true } });
        if (!existing) {
          results.push({ index: i, success: false, error: `Not found: ${id}` });
          continue;
        }
        await requireApiPermission(userId, 'parent_only', 'delete', existing);
        await deleteParentOnly([id]);
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
