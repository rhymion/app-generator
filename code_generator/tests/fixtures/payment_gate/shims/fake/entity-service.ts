// Stand-in for the generated lib/paid_widget/service.ts and
// lib/paid_gadget/service.ts (lifecycle.test.ts only). Each delete models the
// generated delete{Entity}(): it reads the rows first, then removes them, and
// runs the audit event and the afterDelete hook only for rows this call
// actually deleted -- a repeated delete, or one that lost a race to a
// concurrent delete of the same row, does nothing. The removal step is
// serialised the way Postgres serialises two deletes of one row (the second
// waits for the first, then matches no row). A test that sees an id in
// `afterDeleteRan` / `auditRan` knows the dispatcher went through the entity's
// own delete function, not a raw table delete, and how many times.
import { db } from './prisma';

export const afterDeleteRan: string[] = [];
export const auditRan: string[] = [];

export function resetEntityService() {
  afterDeleteRan.length = 0;
  auditRan.length = 0;
  removalLock = Promise.resolve();
}

let removalLock: Promise<void> = Promise.resolve();

async function deleteRows(table: 'paid_widget' | 'paid_gadget', ids: string[]): Promise<void> {
  const found = db[table].filter((r) => ids.includes(r.id)); // findMany before any write
  await Promise.resolve(); // let a concurrent caller run its own read before either deletes
  const previous = removalLock;
  let release!: () => void;
  removalLock = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const before = db[table].length;
    db[table] = db[table].filter((r) => !ids.includes(r.id));
    if (before - db[table].length === 0) return; // nothing deleted: no audit, no hook
    for (const row of found) {
      auditRan.push(`${table}:${row.id}`);
      afterDeleteRan.push(`${table}:${row.id}`);
    }
  } finally {
    release();
  }
}

export async function deletePaidWidget(ids: string[]): Promise<void> {
  await deleteRows('paid_widget', ids);
}

export async function deletePaidGadget(ids: string[]): Promise<void> {
  await deleteRows('paid_gadget', ids);
}
