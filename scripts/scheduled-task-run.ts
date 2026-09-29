// Runs scheduled tasks directly, outside the deployed app's HTTP route — the
// primary production trigger for dependency-ordered scheduled tasks
// (planning/scheduled-task-runall-design.md). Hand-maintained, not generated
// (schema-independent, same category as seed-baseline.ts).
//
//   npm run task:run -- <task_id>   run one task
//   npm run task:run-all            run every task in `depends_on` order
//
// Staging/production: reuse scripts/vercel-seed.sh's env loading and
// --prod/--staging/DRY_RUN handling instead of a second wrapper:
//   SEED_COMMAND=task:run-all ./scripts/vercel-seed.sh [--prod]
//
// Every run goes through the same completion-record guard as the generated
// HTTP route (lib/scheduled-tasks/run-guard.ts), so the two paths share
// duplicate suppression and predecessor checks. `task:run <task_id>` is the
// operator's explicit rerun: it takes over a stale `running` record and
// retries a `failed` one; `task:run-all` never takes over `running`.
//
// Exit codes — task:run: 0 succeeded (incl. already succeeded), 1 handler
// threw, 2 blocked by a predecessor. task:run-all: 0 all succeeded / already
// succeeded / not due, 1 any task failed or was blocked.
//
// NOTE: a handler may call anything the deployed app can call (payment,
// email, third-party APIs). Run outside the deployed app, EVERY env var those
// handlers read must be present here, not just DATABASE_URL.
import path from 'node:path';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(path.resolve(process.cwd()), process.env.NODE_ENV !== 'production');

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const runAllMode = args.includes('--all');
  const taskId = args.find((a) => !a.startsWith('--'));
  if (runAllMode === Boolean(taskId)) {
    console.error('Usage: scheduled-task-run.ts <task_id>   |   scheduled-task-run.ts --all');
    return 64;
  }

  // Imported after loadEnvConfig so lib/prisma sees the loaded DATABASE_URL.
  const { default: prisma } = await import('../lib/prisma');
  const { TASK_REGISTRY } = await import('../lib/scheduled-tasks/registry');
  const { TASK_DEPENDENCIES, TASK_INTERVALS } = await import('../lib/scheduled-tasks/dependencies');
  const guard = await import('../lib/scheduled-tasks/run-guard');
  const { SCHEDULED_TASK_ACTOR_EMAIL } = await import('../lib/scheduled-tasks/system-actor');
  const { runAll, runAllExitCode, runOneExitCode } = await import('../lib/scheduled-tasks/run-all');

  try {
    const actor = await prisma.user.findUnique({
      where: { email: SCHEDULED_TASK_ACTOR_EMAIL },
      select: { id: true },
    });
    if (!actor) {
      throw new Error(
        `Scheduled-task system actor not found (expected a user seeded with email ` +
          `${SCHEDULED_TASK_ACTOR_EMAIL} by db:seed-baseline).`,
      );
    }

    if (taskId) {
      if (!(taskId in TASK_REGISTRY)) {
        console.error(`Unknown scheduled task: ${taskId}. Known: ${Object.keys(TASK_REGISTRY).join(', ') || '(none)'}`);
        return 64;
      }
      const result = await guard.runScheduledTask(taskId, actor.id, { reclaimRunning: true });
      report(result.taskId, result.outcome, result.blockedBy, result.error);
      return runOneExitCode(result.outcome);
    }

    const businessDate = guard.businessDateOf();
    const entries = await runAll({
      dependencies: TASK_DEPENDENCIES,
      intervals: TASK_INTERVALS,
      businessDate,
      lastSucceededBusinessDate: guard.lastSucceededBusinessDate,
      recordNotDue: (id) => guard.recordNotDue(id),
      runTask: (id) => guard.runScheduledTask(id, actor.id),
    });
    console.log(`task:run-all business_date=${businessDate.toISOString().slice(0, 10)}`);
    for (const e of entries) report(e.taskId, e.outcome, e.blockedBy, e.error);
    const count = (o: string) => entries.filter((e) => e.outcome === o).length;
    console.log(
      `Summary: ${count('succeeded')} succeeded, ${count('already_succeeded')} already succeeded, ` +
        `${count('failed')} failed, ${count('blocked') + count('already_running')} blocked, ` +
        `${count('not_due')} not due`,
    );
    return runAllExitCode(entries);
  } finally {
    await prisma.$disconnect();
  }
}

function report(taskId: string, outcome: string, blockedBy?: string[], error?: unknown): void {
  const detail = blockedBy?.length
    ? ` (waiting on: ${blockedBy.join(', ')})`
    : error !== undefined
      ? ` (${error instanceof Error ? error.message : String(error)})`
      : '';
  console.log(`  ${taskId}: ${outcome}${detail}`);
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
