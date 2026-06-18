// AUTO-GENERATED - DO NOT EDIT
import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import prisma from '@/lib/prisma';
import { addWork } from '@/lib/work/service';
import { updateWork, deleteWork } from '@/lib/work/service';

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
// POST /api/work/bulk  — bulk create
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    await requireApiPermission(actorId, 'work', 'create');
    const body = await request.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bulkItems: any[] = Array.isArray(body) ? body : [body];
    const bulkResults: BulkResult<{ id: string }>[] = [];

    for (let i = 0; i < bulkItems.length; i++) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { title, pattern, status, characters_ids, scenes_ids } = bulkItems[i] as any;
        const result = await addWork(actorId, title, pattern, status, characters_ids ?? [], scenes_ids ?? []);
        bulkResults.push({ index: i, success: true, data: result });
      } catch (err) {
        bulkResults.push({ index: i, success: false, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return NextResponse.json(makeBulkResponse(bulkResults), { status: 207 });
  } catch (error) {
    return handleApiError(error);
  }
}

// ---------------------------------------------------------------------------
// PUT /api/work/bulk  — bulk update
// ---------------------------------------------------------------------------
export async function PUT(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    const richPerms = await requireApiPermission(actorId, 'work', 'update');
    const body = await request.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bulkItems: any[] = Array.isArray(body) ? body : [body];

    // Fetch all requested records in one query for existence checks
    const requestedIds = bulkItems.map((item) => item.id).filter(Boolean) as string[];
    const existingRecords = await prisma.work.findMany({
      where: { id: { in: requestedIds } },
      select: { id: true, creator_id: true },
    });
    const existingMap = new Map(existingRecords.map((r) => [r.id, r]));

    const bulkResults: BulkResult<{ success: boolean }>[] = [];

    for (let i = 0; i < bulkItems.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { id, title, pattern, status, characters_ids, scenes_ids } = bulkItems[i] as any;
      const existing = existingMap.get(id);
      if (!existing) {
        bulkResults.push({ index: i, success: false, error: `Not found: ${id}` });
        continue;
      }
      const canUpdate =
        richPerms.general.update ||
        (richPerms.creator?.update && existing.creator_id === actorId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (richPerms.assignee?.update && (existing as any).assignee_id === actorId);
      if (!canUpdate) {
        bulkResults.push({ index: i, success: false, error: `Access denied: ${id}` });
        continue;
      }
      try {
        await updateWork(actorId, id, title, pattern, status, characters_ids ?? [], scenes_ids ?? [], null);
        bulkResults.push({ index: i, success: true, data: { success: true } });
      } catch (err) {
        bulkResults.push({ index: i, success: false, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return NextResponse.json(makeBulkResponse(bulkResults), { status: 207 });
  } catch (error) {
    return handleApiError(error);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/work/bulk  — bulk delete
// ---------------------------------------------------------------------------
export async function DELETE(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    const richPerms = await requireApiPermission(actorId, 'work', 'delete');
    const body = await request.json();
    const bulkItems: { id: string }[] = Array.isArray(body) ? body : [body];

    // Fetch all requested records in one query for existence checks
    const requestedIds = bulkItems.map((item) => item.id);
    const existingRecords = await prisma.work.findMany({
      where: { id: { in: requestedIds } },
      select: { id: true, creator_id: true },
    });
    const existingMap = new Map(existingRecords.map((r) => [r.id, r]));

    // Permission-check pass — collect IDs allowed to delete
    const results: BulkResult<null>[] = [];
    const permitted: { index: number; id: string }[] = [];
    for (let i = 0; i < bulkItems.length; i++) {
      const { id } = bulkItems[i];
      const existing = existingMap.get(id);
      if (!existing) {
        results.push({ index: i, success: false, error: `Not found: ${id}` });
        continue;
      }
      const canDelete =
        richPerms.general.delete ||
        (richPerms.creator?.delete && existing.creator_id === actorId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (richPerms.assignee?.delete && (existing as any).assignee_id === actorId);
      if (!canDelete) {
        results.push({ index: i, success: false, error: `Access denied: ${id}` });
        continue;
      }
      permitted.push({ index: i, id });
    }

    // Batch delete all permitted records in a single query
    if (permitted.length > 0) {
      await deleteWork(permitted.map((p) => p.id));
      for (const { index } of permitted) {
        results.push({ index, success: true, data: null });
      }
    }

    results.sort((a, b) => a.index - b.index);
    return NextResponse.json(makeBulkResponse(results), { status: 207 });
  } catch (error) {
    return handleApiError(error);
  }
}
