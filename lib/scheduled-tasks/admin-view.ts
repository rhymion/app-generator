// Pure view logic for the scheduled-task admin page
// (app/[locale]/scheduled_task_run/page.tsx): which status to show for a
// task on a business date, why a task did not run, and which operator actions
// are open. No database or Prisma access, so it is unit-testable on its own.
//
// Hand-authored (schema-independent), like run-all.ts.

export type RunStatus = 'running' | 'succeeded' | 'failed' | 'not_due';

/** What the page shows: the stored status plus three states derived at read time. */
export type DisplayStatus =
  | RunStatus
  | 'stuck' //   `running` for longer than the stuck-run threshold
  | 'blocked' // no record yet, and a declared predecessor has no usable record
  | 'pending'; // no record yet, and nothing is holding the task back

export interface RunRecord {
  id: string;
  task_id: string;
  business_date: Date;
  status: RunStatus;
  started_at: Date;
  finished_at: Date | null;
  error_message: string | null;
}

export interface TaskRunRow {
  taskId: string;
  businessDate: Date;
  /** Null when no completion record exists for this task and date. */
  recordId: string | null;
  status: DisplayStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorMessage: string | null;
  /** Predecessors lacking a usable record — set only when status is 'blocked'. */
  blockedBy: string[];
  /** The task's cron `interval`, or null when it declares none. */
  interval: string | null;
  actions: OperatorActions;
}

export interface OperatorActions {
  rerun: boolean;
  resolve: boolean;
  skip: boolean;
}

/** Minutes a `running` record may stay open before it counts as stuck. Used when no setting is stored. */
export const DEFAULT_STUCK_AFTER_MINUTES = 60;
/** Minutes between predecessor rechecks. Used when no setting is stored. */
export const DEFAULT_PREDECESSOR_RECHECK_MINUTES = 5;

/** `value` if it is a positive integer, else `fallback` (a NULL or nonsensical stored setting). */
export function positiveIntOr(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

export function isStuck(record: Pick<RunRecord, 'status' | 'started_at'>, now: Date, stuckAfterMinutes: number): boolean {
  return record.status === 'running' && now.getTime() - record.started_at.getTime() > stuckAfterMinutes * 60_000;
}

/**
 * Which operator actions are open for a row.
 *
 * - `succeeded` is final: nothing to do.
 * - a fresh `running` row may be a live run, so it is left alone until it is stuck.
 * - everything else can be rerun, marked resolved (only where a record exists
 *   to flip) or skipped (which also covers a task with no record at all).
 * The guard still enforces the predecessor check on a rerun.
 */
export function allowedActions(status: DisplayStatus): OperatorActions {
  switch (status) {
    case 'succeeded':
    case 'running':
      return { rerun: false, resolve: false, skip: false };
    case 'failed':
    case 'stuck':
      return { rerun: true, resolve: true, skip: true };
    case 'not_due':
    case 'blocked':
    case 'pending':
      return { rerun: true, resolve: false, skip: true };
  }
}

export interface BuildRowsInput {
  /** task_id -> predecessor task_ids, in schema declaration order (TASK_DEPENDENCIES). */
  dependencies: Record<string, string[]>;
  /** task_id -> cron string or null (TASK_INTERVALS). */
  intervals: Record<string, string | null>;
  /** Completion records for `businessDate` (records of other dates are ignored). */
  records: RunRecord[];
  businessDate: Date;
  now: Date;
  stuckAfterMinutes: number;
}

/** One row per declared task for `businessDate`, in declaration order. */
export function buildTaskRows(input: BuildRowsInput): TaskRunRow[] {
  const day = input.businessDate.getTime();
  const byTask = new Map<string, RunRecord>();
  for (const record of input.records) {
    if (record.business_date.getTime() === day) byTask.set(record.task_id, record);
  }
  const usable = new Set(
    [...byTask.values()].filter((r) => r.status === 'succeeded' || r.status === 'not_due').map((r) => r.task_id),
  );

  return Object.keys(input.dependencies).map((taskId) => {
    const record = byTask.get(taskId);
    const interval = input.intervals[taskId] ?? null;
    if (record) {
      const status: DisplayStatus = isStuck(record, input.now, input.stuckAfterMinutes) ? 'stuck' : record.status;
      return {
        taskId,
        businessDate: input.businessDate,
        recordId: record.id,
        status,
        startedAt: record.started_at,
        finishedAt: record.finished_at,
        errorMessage: record.error_message,
        blockedBy: [],
        interval,
        actions: allowedActions(status),
      };
    }
    const blockedBy = (input.dependencies[taskId] ?? []).filter((p) => !usable.has(p));
    const status: DisplayStatus = blockedBy.length > 0 ? 'blocked' : 'pending';
    return {
      taskId,
      businessDate: input.businessDate,
      recordId: null,
      status,
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
      blockedBy,
      interval,
      actions: allowedActions(status),
    };
  });
}

/** Parse a `YYYY-MM-DD` search param to UTC midnight; anything else yields null. */
export function parseBusinessDate(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

export function formatBusinessDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
