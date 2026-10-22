// In-memory stand-in for the slice of Prisma that bridge_actions.ts uses.
// Org A: attachables attA1 (owner resource_a1, editable by the caller) and
// attA2 (owner resource_a2, same organization, not editable). Org B: attB1.
type Row = { id: string; attachable_id: string; type: number; name: string; path: string; order: number };
type Where = { id?: string | { in: string[] }; attachable_id?: string; type?: number };

const OWNERS: Record<string, { id: string; organization_id: string }> = {
  attA1: { id: 'resource_a1', organization_id: 'orgA' },
  attA2: { id: 'resource_a2', organization_id: 'orgA' },
  attB1: { id: 'resource_b1', organization_id: 'orgB' },
};

export const db: { attachments: Row[] } = { attachments: [] };

export function reset(): void {
  db.attachments = [
    { id: 'a1', attachable_id: 'attA1', type: 1, name: 'a1', path: '/a1.png', order: 0 },
    { id: 'a2', attachable_id: 'attA1', type: 1, name: 'a2', path: '/a2.png', order: 1 },
    { id: 'a3', attachable_id: 'attA1', type: 2, name: 'a3', path: '/a3.pdf', order: 0 },
    { id: 'x1', attachable_id: 'attA2', type: 1, name: 'x1', path: '/x1.png', order: 0 },
    { id: 'b1', attachable_id: 'attB1', type: 1, name: 'b1', path: '/b1.png', order: 0 },
  ];
}
reset();

function matches(r: Row, w: Where): boolean {
  if (typeof w.id === 'string' && r.id !== w.id) return false;
  if (typeof w.id === 'object' && !w.id.in.includes(r.id)) return false;
  if (w.attachable_id !== undefined && r.attachable_id !== w.attachable_id) return false;
  if (w.type !== undefined && r.type !== w.type) return false;
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
    Object.assign(row, { name: data.name, path: data.path, order: data.order });
  },
  create: async ({ data }: { data: Omit<Row, 'id'> }) => {
    db.attachments.push({ id: `new${db.attachments.length}`, ...data });
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
