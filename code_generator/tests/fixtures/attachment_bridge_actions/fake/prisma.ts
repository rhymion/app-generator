// In-memory stand-in for the slice of Prisma that bridge_actions.ts uses.
// Org A: attachables attA1 (owner resource_a1, editable by the caller) and
// attA2 (owner resource_a2, same organization, not editable). Org B: attB1.
// Two uploads no record references yet: u1 (uploaded by the caller, user_a) and u2 (by user_b).
type Row = {
  id: string;
  attachable_id: string | null;
  type: number;
  name: string;
  path: string;
  order: number;
  uploader_id: string | null;
};
type Where = { id?: string | { in: string[] }; attachable_id?: string | null; type?: number; uploader_id?: string };

const OWNERS: Record<string, { id: string; organization_id: string }> = {
  attA1: { id: 'resource_a1', organization_id: 'orgA' },
  attA2: { id: 'resource_a2', organization_id: 'orgA' },
  attB1: { id: 'resource_b1', organization_id: 'orgB' },
};

export const db: { attachments: Row[] } = { attachments: [] };

export function reset(): void {
  db.attachments = [
    { id: 'a1', attachable_id: 'attA1', type: 1, name: 'a1', path: '11111111-1111-4111-8111-111111111111', order: 0, uploader_id: 'user_a' },
    { id: 'a2', attachable_id: 'attA1', type: 1, name: 'a2', path: '22222222-2222-4222-8222-222222222222', order: 1, uploader_id: 'user_a' },
    { id: 'a3', attachable_id: 'attA1', type: 2, name: 'a3', path: '33333333-3333-4333-8333-333333333333', order: 0, uploader_id: 'user_a' },
    { id: 'x1', attachable_id: 'attA2', type: 1, name: 'x1', path: '44444444-4444-4444-8444-444444444444', order: 0, uploader_id: 'user_b' },
    { id: 'b1', attachable_id: 'attB1', type: 1, name: 'b1', path: '55555555-5555-4555-8555-555555555555', order: 0, uploader_id: 'user_c' },
    { id: 'u1', attachable_id: null, type: 1, name: 'u1', path: '66666666-6666-4666-8666-666666666666', order: 0, uploader_id: 'user_a' },
    { id: 'u2', attachable_id: null, type: 1, name: 'u2', path: '77777777-7777-4777-8777-777777777777', order: 0, uploader_id: 'user_b' },
  ];
}
reset();

function matches(r: Row, w: Where): boolean {
  if (typeof w.id === 'string' && r.id !== w.id) return false;
  if (typeof w.id === 'object' && !w.id.in.includes(r.id)) return false;
  if (w.attachable_id !== undefined && r.attachable_id !== w.attachable_id) return false;
  if (w.type !== undefined && r.type !== w.type) return false;
  if (w.uploader_id !== undefined && r.uploader_id !== w.uploader_id) return false;
  return true;
}

const attachment = {
  findMany: async ({ where }: { where: Where }) => db.attachments.filter((r) => matches(r, where)).map((r) => ({ ...r })),
  deleteMany: async ({ where }: { where: Where }) => {
    db.attachments = db.attachments.filter((r) => !matches(r, where));
  },
  update: async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
    const row = db.attachments.find((r) => matches(r, where));
    if (!row) throw new Error('Record to update not found');
    Object.assign(row, data);
  },
  updateMany: async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
    const rows = db.attachments.filter((r) => matches(r, where));
    for (const row of rows) Object.assign(row, data);
    return { count: rows.length };
  },
};

const prisma = {
  attachable: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const owner = OWNERS[where.id];
      return owner ? { resource: { id: owner.id, creator_id: 'user_a' } } : null;
    },
  },
  attachment,
  // Mirrors a real transaction closely enough for this check: a throw rolls back every write.
  $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    const snapshot = db.attachments.map((r) => ({ ...r }));
    try {
      return await fn(prisma);
    } catch (e) {
      db.attachments = snapshot;
      throw e;
    }
  },
};

export default prisma;
