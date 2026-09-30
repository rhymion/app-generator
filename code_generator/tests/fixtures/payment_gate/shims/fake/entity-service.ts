// Stand-in for the generated lib/paid_widget/service.ts and
// lib/paid_gadget/service.ts (lifecycle.test.ts only). Each delete removes
// the row from the in-memory table and records the call, standing in for the
// generated delete{Entity}() *and* the afterDelete hook it runs: a test that
// sees an id in `afterDeleteRan` knows the dispatcher went through the
// entity's own delete function, not a raw table delete.
import { db } from './prisma';

export const afterDeleteRan: string[] = [];

export function resetEntityService() {
  afterDeleteRan.length = 0;
}

export async function deletePaidWidget(ids: string[]): Promise<void> {
  db.paid_widget = db.paid_widget.filter((r) => !ids.includes(r.id));
  afterDeleteRan.push(...ids.map((id) => `paid_widget:${id}`));
}

export async function deletePaidGadget(ids: string[]): Promise<void> {
  db.paid_gadget = db.paid_gadget.filter((r) => !ids.includes(r.id));
  afterDeleteRan.push(...ids.map((id) => `paid_gadget:${id}`));
}
