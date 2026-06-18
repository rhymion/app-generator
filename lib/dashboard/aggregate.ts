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

// Server Action — enforces session auth then delegates to aggregateForWidgetCore.
export async function aggregateForWidget(
  entityName: string,
  groupByField: string,
  filter: AggregateFilter = null,
  seriesField?: string,
  conditions?: FilterCondition[],
  groupByBucket?: BucketGranularity,
): Promise<AggregateOutput> {
  await getSessionUserIdOrThrow();
  return aggregateForWidgetCore(entityName, groupByField, filter, seriesField, conditions, groupByBucket);
}
