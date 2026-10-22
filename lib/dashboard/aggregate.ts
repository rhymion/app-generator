'use server';

import { getSessionUserIdOrThrow } from '@/lib/authz';
import { AppError } from '@/lib/_errors';
import { WidgetProblemError, type WidgetProblem } from './widget-problem';
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

// What the widget receives. A widget that cannot be drawn comes back as a typed problem, not a thrown error:
// in a production build React replaces the message of an exception thrown from a Server Action with a generic
// one, so only data reaches the user intact.
export type AggregateResult =
  | { ok: true; output: AggregateOutput }
  | { ok: false; problem: WidgetProblem };

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
): Promise<AggregateResult> {
  const userId = await getSessionUserIdOrThrow();
  try {
    const output = await aggregateForWidgetCore(userId, entityName, groupByField, filter, seriesField, conditions, groupByBucket, timezone);
    return { ok: true, output };
  } catch (e) {
    if (e instanceof WidgetProblemError) return { ok: false, problem: e.problem };
    // The viewer may not read the data source.
    if (e instanceof AppError && e.code === 'PERMISSION_DENIED') {
      return { ok: false, problem: { code: 'noPermission', setting: 'entity_name', params: { entity: entityName } } };
    }
    throw e;
  }
}
