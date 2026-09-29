// Pure planning/decision logic for `task:run-all` (scripts/scheduled-task-run.ts):
// dependency ordering, the "is this task due tonight" cadence check, and the
// run-all orchestration loop. No database or Prisma access here — the script
// injects the guard's functions — so it is unit-testable without a database.
//
// Hand-authored (schema-independent), unlike the generated sibling files
// registry.ts / dependencies.ts / run-guard.ts.
import { CronExpressionParser } from 'cron-parser';
import type { ScheduledTaskOutcome, ScheduledTaskResult } from './run-guard';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Topological order over `dependencies` (task_id -> predecessor task_ids):
 * Kahn's algorithm, repeatedly taking the first not-yet-processed task — in
 * the object's key order, i.e. schema declaration order — whose predecessors
 * are all processed. Ties between independent branches therefore resolve the
 * same way on every run. A cycle throws; validate.py already rejects cycles
 * at generate time, so this is a backstop, not a feature. Predecessors that
 * are not keys of `dependencies` are ignored (also validate.py's job).
 */
export function topologicalOrder(dependencies: Record<string, string[]>): string[] {
  const ids = Object.keys(dependencies);
  const known = new Set(ids);
  const done = new Set<string>();
  const order: string[] = [];
  while (order.length < ids.length) {
    const next = ids.find(
      (id) => !done.has(id) && dependencies[id].every((p) => !known.has(p) || done.has(p)),
    );
    if (next === undefined) {
      const stuck = ids.filter((id) => !done.has(id));
      throw new Error(`Dependency cycle among scheduled tasks: ${stuck.join(', ')}`);
    }
    done.add(next);
    order.push(next);
  }
  return order;
}

/**
 * Is a task due on `businessDate` (UTC midnight)? `interval` is read as
 * "when this task is due", not "when to invoke it": the task is due once a
 * scheduled occurrence has passed since its last success.
 *
 *  - no `interval`                 -> due every night
 *  - never succeeded (no record)   -> due immediately, whatever `interval` says
 *  - otherwise                     -> due iff the first cron occurrence on a
 *    calendar day after `lastSucceeded`'s day falls on or before `businessDate`.
 *
 * The comparison is by UTC calendar day (business_date is date-granular), so a
 * daily cron is due every night whatever its minute/hour, and a long stop folds
 * into one catch-up run — only the last success is consulted, not each missed
 * occurrence. `interval` is a 5-field cron expression evaluated in UTC.
 */
export function isDue(interval: string | null, lastSucceeded: Date | null, businessDate: Date): boolean {
  if (!interval || !lastSucceeded) return true;
  // Start the search just before the next day's UTC midnight so an occurrence
  // at exactly 00:00 of the following day still counts.
  const searchFrom = new Date(lastSucceeded.getTime() + DAY_MS - 1);
  const next = CronExpressionParser.parse(interval, { currentDate: searchFrom, tz: 'UTC' })
    .next()
    .toDate();
  return next.getTime() < businessDate.getTime() + DAY_MS;
}

export type RunAllOutcome = ScheduledTaskOutcome | 'not_due';

export interface RunAllEntry {
  taskId: string;
  outcome: RunAllOutcome;
  blockedBy?: string[];
  error?: unknown;
}

export interface RunAllDeps {
  dependencies: Record<string, string[]>;
  intervals: Record<string, string | null>;
  businessDate: Date;
  lastSucceededBusinessDate: (taskId: string) => Promise<Date | null>;
  recordNotDue: (taskId: string) => Promise<void>;
  runTask: (taskId: string) => Promise<ScheduledTaskResult>;
}

/**
 * One run-all pass: every task, in dependency order. A failed task does not
 * stop the pass — independent branches keep running, and a downstream task is
 * refused by the guard's own predecessor check (outcome 'blocked'), so no
 * separate cascade-skip logic exists here.
 */
export async function runAll(deps: RunAllDeps): Promise<RunAllEntry[]> {
  const entries: RunAllEntry[] = [];
  for (const taskId of topologicalOrder(deps.dependencies)) {
    const interval = deps.intervals[taskId] ?? null;
    if (interval) {
      const last = await deps.lastSucceededBusinessDate(taskId);
      if (last && last.getTime() >= deps.businessDate.getTime()) {
        // Already succeeded for this business date: the guard reports it.
      } else if (!isDue(interval, last, deps.businessDate)) {
        await deps.recordNotDue(taskId);
        entries.push({ taskId, outcome: 'not_due' });
        continue;
      }
    }
    const result = await deps.runTask(taskId);
    entries.push({
      taskId,
      outcome: result.outcome,
      ...(result.blockedBy ? { blockedBy: result.blockedBy } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
    });
  }
  return entries;
}

/**
 * `task:run-all` exit code: 0 when every task succeeded, was already
 * succeeded, or was correctly not due; 1 when any task failed or was refused
 * (blocked / already running). A not-due skip alone never sets it.
 */
export function runAllExitCode(entries: RunAllEntry[]): 0 | 1 {
  return entries.some((e) => e.outcome === 'failed' || e.outcome === 'blocked' || e.outcome === 'already_running')
    ? 1
    : 0;
}

/** `task:run <task_id>` exit code: 0 succeeded/already succeeded, 1 handler threw, 2 blocked. */
export function runOneExitCode(outcome: ScheduledTaskOutcome): 0 | 1 | 2 {
  switch (outcome) {
    case 'succeeded':
    case 'already_succeeded':
      return 0;
    case 'failed':
      return 1;
    case 'blocked':
    case 'already_running':
      return 2;
  }
}
