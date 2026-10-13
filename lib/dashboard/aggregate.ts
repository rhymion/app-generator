'use server';

import { getSessionUserIdOrThrow } from '@/lib/authz';
import {
  aggregateForWidgetCore,
  type AggregateFilter,
  type FilterCondition,
  type BucketGranularity,
  type AggregateOutput,
} from './aggregate-core';

// Re-export types so existing importers (DashboardWidget.tsx etc.) need no changes.
export type {
  AggregateBucket,
  AggregateFilter,
  BucketGranularity,
  FilterCondition,
  AggregateOutput,
} from './aggregate-core';

// Server Action — enforces session auth, then delegates to aggregateForWidgetCore, which requires
// the user's read permission on the entity and applies its row-level read scope.
export async function aggregateForWidget(
  entityName: string,
  groupByField: string,
  filter: AggregateFilter = null,
  seriesField?: string,
  conditions?: FilterCondition[],
  groupByBucket?: BucketGranularity,
  timezone?: string | null,
): Promise<AggregateOutput> {
  const userId = await getSessionUserIdOrThrow();
  return aggregateForWidgetCore(userId, entityName, groupByField, filter, seriesField, conditions, groupByBucket, timezone);
}
