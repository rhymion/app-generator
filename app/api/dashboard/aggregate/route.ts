import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, requireApiPermission, handleApiError } from '@/lib/api-auth';
import { aggregateForWidgetCore } from '@/lib/dashboard/aggregate-core';
import type { AggregateFilter, FilterCondition, BucketGranularity } from '@/lib/dashboard/aggregate-core';

// group_by_bucket integer enum: 0=day,1=week,2=month,3=quarter,4=year.
const BUCKET_LABELS: BucketGranularity[] = ['day', 'week', 'month', 'quarter', 'year'];
function resolveBucket(raw: number | undefined): BucketGranularity | undefined {
  if (raw == null) return undefined;
  if (raw >= 0 && raw < BUCKET_LABELS.length) return BUCKET_LABELS[raw];
  return undefined;
}

// POST /api/dashboard/aggregate
// Body: { entity_name, group_by_field, filter?, conditions?, series_field?, group_by_bucket? }
// group_by_bucket accepts integer enum (0-4).
// Returns AggregateOutput (single-series or multi-series).
// Enforces API-key auth and read permission on the target entity.
export async function POST(request: NextRequest) {
  try {
    const { userId: actorId } = await authenticateApiKey(request);
    const body = await request.json() as {
      entity_name?: string;
      group_by_field?: string;
      filter?: AggregateFilter;
      conditions?: FilterCondition[];
      series_field?: string;
      group_by_bucket?: number;
    };
    const { entity_name, group_by_field, filter, conditions, series_field, group_by_bucket } = body;
    if (!entity_name || !group_by_field) {
      return NextResponse.json(
        { error: 'entity_name and group_by_field are required' },
        { status: 400 },
      );
    }
    await requireApiPermission(actorId, entity_name, 'read');
    const result = await aggregateForWidgetCore(
      entity_name,
      group_by_field,
      filter ?? null,
      series_field,
      conditions,
      resolveBucket(group_by_bucket),
    );
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
