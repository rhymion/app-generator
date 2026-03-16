// AUTO-GENERATED - DO NOT EDIT
import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import prisma from '@/lib/prisma';
import { addPermission } from '@/lib/permission/service';
import { updatePermission, deletePermission } from '@/lib/permission/service';

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
// POST /api/permission/bulk  — bulk create
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const { userId } = await authenticateApiKey(request);
    await requireApiPermission(userId, 'permission', 'create');
    const body = await request.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bulkItems: any[] = Array.isArray(body) ? body : [body];
    const results: BulkResult<{ id: string }>[] = [];

    for (let i = 0; i < bulkItems.length; i++) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { name, create, read, update, delete: deleteValue, role_id: roleId } = bulkItems[i] as any;
        const result = await addPermission(userId, name, create, read, update, deleteValue, roleId ?? null);
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
// PUT /api/permission/bulk  — bulk update
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
        const { id, name, create, read, update, delete: deleteValue, role_id: roleId } = bulkItems[i] as any;
        const existing = await prisma.permission.findUnique({ where: { id }, select: { creator_id: true } });
        if (!existing) {
          results.push({ index: i, success: false, error: `Not found: ${id}` });
          continue;
        }
        await requireApiPermission(userId, 'permission', 'update', existing);
        await updatePermission(userId, id, name, create, read, update, deleteValue, roleId ?? null, null);
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
// DELETE /api/permission/bulk  — bulk delete
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
        const existing = await prisma.permission.findUnique({ where: { id }, select: { creator_id: true } });
        if (!existing) {
          results.push({ index: i, success: false, error: `Not found: ${id}` });
          continue;
        }
        await requireApiPermission(userId, 'permission', 'delete', existing);
        await deletePermission([id]);
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
