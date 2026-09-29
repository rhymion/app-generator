// In-memory stand-in for @/lib/prisma used only by lifecycle.test.ts (the
// payment-gate fixture's behaviour check). It implements just the calls the
// generated lib/payment/*.ts makes -- findUnique / create / update /
// updateMany / deleteMany on `payable`, findUnique on the two entity tables --
// with the same semantics that matter to the lifecycle: unique lookups return
// null when absent, and updateMany/deleteMany report how many rows matched.
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const db: Record<'payable' | 'paid_widget' | 'paid_gadget', Row[]> = {
  payable: [],
  paid_widget: [],
  paid_gadget: [],
};

export function resetDb() {
  db.payable = [];
  db.paid_widget = [];
  db.paid_gadget = [];
}

let seq = 0;

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, want]) => {
    if (key === 'entity_name_record_id') {
      return row.entity_name === want.entity_name && row.record_id === want.record_id;
    }
    return row[key] === want;
  });
}

function table(name: keyof typeof db) {
  return {
    async findUnique({ where }: { where: Row }) {
      return db[name].find((r) => matches(r, where)) ?? null;
    },
    async create({ data }: { data: Row }) {
      const row = { id: `pay_${++seq}`, status: 'pending', currency: 'usd', amount: null, paid_at: null, ...data };
      db[name].push(row);
      return row;
    },
    async update({ where, data }: { where: Row; data: Row }) {
      const row = db[name].find((r) => matches(r, where));
      if (!row) throw new Error('record not found');
      Object.assign(row, data);
      return row;
    },
    async updateMany({ where, data }: { where: Row; data: Row }) {
      const rows = db[name].filter((r) => matches(r, where));
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    },
    async deleteMany({ where }: { where: Row }) {
      const before = db[name].length;
      db[name] = db[name].filter((r) => !matches(r, where));
      return { count: before - db[name].length };
    },
  };
}

const prisma = {
  payable: table('payable'),
  paid_widget: table('paid_widget'),
  paid_gadget: table('paid_gadget'),
};
export default prisma;
