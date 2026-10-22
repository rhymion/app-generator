// In-memory stand-in for @/lib/prisma used only by lifecycle.test.ts (the
// payment-gate fixture's behaviour check). It implements just the calls the
// generated lib/payment/*.ts makes -- findUnique / create / update /
// updateMany / deleteMany on `payable`, findUnique on the entity tables --
// with the same semantics that matter to the lifecycle: unique lookups return
// null when absent, and updateMany/deleteMany report how many rows matched.
// findUnique also resolves a nested `select: { <relation>: { select: ... } }`
// through the `<relation>_id` foreign key, which is how a Price living on a
// related entity is read.
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const db: Record<'payable' | 'paid_widget' | 'paid_gadget' | 'widget_catalog', Row[]> = {
  payable: [],
  paid_widget: [],
  paid_gadget: [],
  widget_catalog: [],
};

export function resetDb() {
  db.payable = [];
  db.paid_widget = [];
  db.paid_gadget = [];
  db.widget_catalog = [];
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
    async findUnique({ where, select }: { where: Row; select?: Row }) {
      const row = db[name].find((r) => matches(r, where));
      if (!row) return null;
      if (!select) return row;
      const picked: Row = {};
      for (const [key, want] of Object.entries(select)) {
        if (typeof want === 'object' && want.select) {
          const related = db[key as keyof typeof db]?.find((r) => r.id === row[`${key}_id`]) ?? null;
          picked[key] = related && Object.fromEntries(Object.keys(want.select).map((k) => [k, related[k]]));
        } else {
          picked[key] = row[key];
        }
      }
      return picked;
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
  widget_catalog: table('widget_catalog'),
};
export default prisma;
