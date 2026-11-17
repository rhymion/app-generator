// Server Action side of the reference rule (Issue #1324): the generated `upsert<Entity>` / `remove<Entity>`
// actions refuse every kind of reference to a row the actor cannot reach, exactly like the REST routes
// (cypress/e2e/fk_reference_shapes.cy.ts covers those):
//   * writing a reference to an unreachable row, or adding one to a set               -> NOT_FOUND
//   * re-pointing / clearing such a reference, removing such a set member, or dropping
//     the inline row that holds one                                                    -> PERMISSION_DENIED
//   * deleting a record that holds such a reference                                    -> PERMISSION_DENIED
// and nothing is written: every refusal re-reads the record (with its set members and inline rows) and the
// referenced row.
//
// Run by scripts/check_security_matrix_e2e_gate_fixture.sh inside the gate's build copy, after the Cypress
// specs, against the copy's database (copied to test/flows/security_matrix_e2e_gate/). The actions are the
// generated ones, called as a given user through runAsActor() (lib/_request_scope.ts), the same override the
// REST routes use to reach shared session code; lib/authz, the services and the database are real. Only
// next-auth (which does not load under vitest), the Next.js navigation/cache helpers and the rate limiter's
// Redis backend (the in-memory one is used) are replaced.
import path from 'node:path';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(path.resolve(process.cwd()), process.env.NODE_ENV !== 'production');

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { RedirectSignal } = vi.hoisted(() => {
  class RedirectSignal extends Error {
    constructor(public url: string) {
      super(`redirect ${url}`);
    }
  }
  return { RedirectSignal };
});

vi.mock('@/auth', () => ({ auth: async () => null, signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
// getRateLimiter() picks its implementation with a runtime require('./redis' | './in-memory'), which vitest
// cannot resolve; the shipped in-memory limiter is used instead (same buckets, same per-actor accounting).
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/rate-limit')>();
  const { createInMemoryRateLimiter } = await import('@/lib/rate-limit/in-memory');
  const limiter = createInMemoryRateLimiter(original.DEFAULT_BUCKETS);
  return { ...original, getRateLimiter: () => limiter };
});
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));

const { default: prisma } = await import('@/lib/prisma');
const { runAsActor } = await import('@/lib/_request_scope');
const { assertCellAndStatus } = await import('@/test/helpers/security_core');
const { loadManifest } = await import('@/test/helpers/security_manifest');
const { resetTestDatabase, seedTestDatabase } = await import('@/cypress/support/db-helpers');
const { seedRow, updateRow, seedScopedActor } = await import('@/cypress/support/security_seed');
const { TEST_CREDENTIALS } = await import('@/cypress/support/test-credentials');
const ticketActions = await import('@/lib/sx_ticket/actions');
const profileActions = await import('@/lib/sx_profile/actions');
const taskActions = await import('@/lib/sx_task/actions');
const noteActions = await import('@/lib/sx_note/actions');
const entryActions = await import('@/lib/sx_entry/actions');

type Row = { id: string } & Record<string, unknown>;
type Snap = { model: string; where?: Record<string, unknown>; include?: Record<string, unknown> };
type Fields = Record<string, string | string[]>;
type ActionResult = { ok: false; errorCode: string } | 'redirect' | 'done';

const db = prisma as unknown as Record<string, { findMany(args: unknown): Promise<unknown[]>; findFirst(args: unknown): Promise<Row | null> }>;

let orgA = '';
let orgB = '';
let adminId = '';
let writer = '';
let seq = 0;
const uniq = (prefix: string) => `${prefix} ${Date.now()}-${++seq}`;
const audit = (userId = adminId) => ({ creator_id: userId, updater_id: userId });

const WRITER_ENTITIES = ['sx_ticket', 'sx_account', 'sx_tag', 'sx_note', 'sx_profile', 'sx_split', 'sx_task', 'sx_entry'];

beforeAll(async () => {
  await resetTestDatabase();
  await seedTestDatabase();
  const admin = await prisma.user.findFirstOrThrow({ where: { email: TEST_CREDENTIALS.email } });
  adminId = admin.id;
  orgA = (await seedRow('organization', { name: uniq('flow org A'), ...audit() })).id as string;
  orgB = (await seedRow('organization', { name: uniq('flow org B'), ...audit() })).id as string;
}, 120_000);

// A fresh writer per test: a member of organization A only, with general rights on every fixture entity, so the
// per-actor rate limit of the actions never trips and nothing depends on the seeded Administrator role.
beforeEach(async () => {
  writer = (
    await seedScopedActor('flow_writer', [orgA], [
      ...WRITER_ENTITIES.map((entity) => ({
        entity,
        scope: 'general' as const,
        flags: { create: true, read: true, update: true, delete: true },
      })),
      { entity: 'organization', scope: 'general', flags: { read: true } },
    ])
  ).userId;
});

// --- rows and calls ------------------------------------------------------------------------------------------

async function newAccount(org: string, extra: Record<string, unknown> = {}): Promise<Row> {
  const c = await seedRow('commentable', {});
  return (await seedRow('sx_account', { name: uniq('account'), organization_id: org, commentable_id: c.id, ...audit(), ...extra })) as Row;
}

async function newRow(model: string, org: string, extra: Record<string, unknown> = {}): Promise<Row> {
  if (model === 'sx_account') return newAccount(org, extra);
  if (model === 'sx_split') return (await seedRow('sx_split', { title: uniq('split'), organization_id: org, ...audit(), ...extra })) as Row;
  if (model === 'sx_ticket') {
    const account = await newAccount(org);
    return (await seedRow('sx_ticket', { title: uniq('ticket'), organization_id: org, sx_account_id: account.id, ...audit(), ...extra })) as Row;
  }
  return (await seedRow(model, { name: uniq(model), organization_id: org, ...audit(), ...extra })) as Row;
}

function formData(fields: Fields): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
    else fd.set(k, v);
  }
  return fd;
}

async function call(actorId: string, fn: () => Promise<unknown>): Promise<ActionResult> {
  try {
    const r = await runAsActor(actorId, fn);
    return (r as ActionResult | undefined) ?? 'done';
  } catch (e) {
    if (e instanceof RedirectSignal) return 'redirect';
    throw e;
  }
}

async function readAll(specs: Snap[]): Promise<string> {
  const out: unknown[] = [];
  for (const s of specs) {
    out.push(await db[s.model].findMany({ where: s.where ?? {}, orderBy: { id: 'asc' }, ...(s.include ? { include: s.include } : {}) }));
  }
  return JSON.stringify(out);
}

const STATUS_OF: Record<string, number> = { NOT_FOUND: 404, PERMISSION_DENIED: 403 };

type Cell = { entity: string; operation: string; case: string; fk_shape: string };

/** The action is refused with the error the cell's case declares, and every row of `keep` is unchanged. */
async function expectRefused(cell: Cell, run: () => Promise<unknown>, keep: Snap[], actorId = writer): Promise<void> {
  const status = cell.case === 'fk_to_unreachable' ? 404 : 403;
  assertCellAndStatus(cell, status, loadManifest());
  const before = await readAll(keep);
  const result = await call(actorId, run);
  expect(result, JSON.stringify(cell)).toMatchObject({ ok: false });
  expect(STATUS_OF[(result as { errorCode: string }).errorCode], JSON.stringify(result)).toBe(status);
  expect(await readAll(keep), 'rows re-read after the refused action').toBe(before);
}

async function expectSaved(run: () => Promise<unknown>, actorId = writer): Promise<void> {
  const result = await call(actorId, run);
  expect(result, JSON.stringify(result)).toBe('redirect');
}

// --- entities with single references -------------------------------------------------------------------------

type SingleRef = { prop: string; shape: string; model: string; optional: boolean };
type SingleEntity = {
  entity: string;
  /** Unique column the test finds a created record by. */
  key: string;
  refs: SingleRef[];
  upsert: (fd: FormData) => Promise<unknown>;
  remove: (ids: string[]) => Promise<unknown>;
  /** The form fields of a record whose references are `refs`. */
  fields(key: string, refs: Record<string, string | null>): Fields;
};

const SINGLE_ENTITIES: SingleEntity[] = [
  {
    entity: 'sx_task',
    key: 'title',
    refs: [{ prop: 'sx_account_id', shape: 'many_to_one_required', model: 'sx_account', optional: false }],
    upsert: taskActions.upsertSxTask,
    remove: taskActions.removeSxTask,
    fields: (key, r) => ({ title: key, status: 'draft', organization_id: orgA, sx_account_id: r.sx_account_id ?? '' }),
  },
  {
    entity: 'sx_profile',
    key: 'title',
    refs: [
      { prop: 'sx_account_id', shape: 'one_to_one_required', model: 'sx_account', optional: false },
      { prop: 'sx_split_id', shape: 'one_to_one_optional', model: 'sx_split', optional: true },
    ],
    upsert: profileActions.upsertSxProfile,
    remove: profileActions.removeSxProfile,
    fields: (key, r) => ({ title: key, organization_id: orgA, sx_account_id: r.sx_account_id ?? '', sx_split_id: r.sx_split_id ?? '' }),
  },
  {
    entity: 'sx_note',
    key: 'name',
    refs: [{ prop: 'sx_ticket_id', shape: 'many_to_one_optional', model: 'sx_ticket', optional: true }],
    upsert: noteActions.upsertSxNote,
    remove: noteActions.removeSxNote,
    fields: (key, r) => ({ name: key, organization_id: orgA, sx_ticket_id: r.sx_ticket_id ?? '' }),
  },
  {
    entity: 'sx_entry',
    key: 'code',
    refs: [
      { prop: 'sx_account_id', shape: 'many_to_one_required', model: 'sx_account', optional: false },
      { prop: 'sx_backup_account_id', shape: 'many_to_one_optional', model: 'sx_account', optional: true },
    ],
    upsert: entryActions.upsertSxEntry,
    remove: entryActions.removeSxEntry,
    fields: (key, r) => ({ code: key, organization_id: orgA, sx_account_id: r.sx_account_id ?? '', sx_backup_account_id: r.sx_backup_account_id ?? '' }),
  },
];

/** Fresh reachable rows (organization A) for every reference of the entity. */
async function reachableRefs(e: SingleEntity): Promise<Record<string, string>> {
  const refs: Record<string, string> = {};
  for (const r of e.refs) refs[r.prop] = (await newRow(r.model, orgA)).id;
  return refs;
}

/** Creates a record through the action as the writer and returns its id. */
async function createSingle(e: SingleEntity, refs: Record<string, string | null>): Promise<string> {
  const key = uniq(e.entity);
  await expectSaved(() => e.upsert(formData(e.fields(key, refs))));
  const row = await db[e.entity].findFirst({ where: { [e.key]: key } });
  expect(row, `${e.entity} ${key} created`).not.toBeNull();
  return row!.id;
}

// security-cell: entity=sx_task operation=action_add case=fk_to_unreachable fk_shape=many_to_one_required
// security-cell: entity=sx_task operation=action_update case=fk_to_unreachable fk_shape=many_to_one_required
// security-cell: entity=sx_task operation=action_update case=fk_away_unreachable fk_shape=many_to_one_required
// security-cell: entity=sx_task operation=action_delete case=fk_delete_unreachable fk_shape=many_to_one_required
// security-cell: entity=sx_profile operation=action_add case=fk_to_unreachable fk_shape=one_to_one_required
// security-cell: entity=sx_profile operation=action_add case=fk_to_unreachable fk_shape=one_to_one_optional
// security-cell: entity=sx_profile operation=action_update case=fk_to_unreachable fk_shape=one_to_one_required
// security-cell: entity=sx_profile operation=action_update case=fk_to_unreachable fk_shape=one_to_one_optional
// security-cell: entity=sx_profile operation=action_update case=fk_away_unreachable fk_shape=one_to_one_required
// security-cell: entity=sx_profile operation=action_update case=fk_away_unreachable fk_shape=one_to_one_optional
// security-cell: entity=sx_profile operation=action_update case=fk_null_unreachable fk_shape=one_to_one_optional
// security-cell: entity=sx_profile operation=action_delete case=fk_delete_unreachable fk_shape=one_to_one_required
// security-cell: entity=sx_profile operation=action_delete case=fk_delete_unreachable fk_shape=one_to_one_optional
// security-cell: entity=sx_note operation=action_add case=fk_to_unreachable fk_shape=many_to_one_optional
// security-cell: entity=sx_note operation=action_update case=fk_to_unreachable fk_shape=many_to_one_optional
// security-cell: entity=sx_note operation=action_update case=fk_away_unreachable fk_shape=many_to_one_optional
// security-cell: entity=sx_note operation=action_update case=fk_null_unreachable fk_shape=many_to_one_optional
// security-cell: entity=sx_note operation=action_delete case=fk_delete_unreachable fk_shape=many_to_one_optional
// security-cell: entity=sx_entry operation=action_add case=fk_to_unreachable fk_shape=many_to_one_required
// security-cell: entity=sx_entry operation=action_add case=fk_to_unreachable fk_shape=many_to_one_optional
// security-cell: entity=sx_entry operation=action_update case=fk_to_unreachable fk_shape=many_to_one_required
// security-cell: entity=sx_entry operation=action_update case=fk_to_unreachable fk_shape=many_to_one_optional
// security-cell: entity=sx_entry operation=action_update case=fk_away_unreachable fk_shape=many_to_one_required
// security-cell: entity=sx_entry operation=action_update case=fk_away_unreachable fk_shape=many_to_one_optional
// security-cell: entity=sx_entry operation=action_update case=fk_null_unreachable fk_shape=many_to_one_optional
// security-cell: entity=sx_entry operation=action_delete case=fk_delete_unreachable fk_shape=many_to_one_required
// security-cell: entity=sx_entry operation=action_delete case=fk_delete_unreachable fk_shape=many_to_one_optional
for (const e of SINGLE_ENTITIES) {
  describe(`${e.entity} Server Actions: a reference to a row of another organization`, () => {
    for (const ref of e.refs) {
      const cell = (operation: string, kase: string): Cell => ({ entity: e.entity, operation, case: kase, fk_shape: ref.shape });

      it(`add with ${ref.prop} in a foreign org is refused (NOT_FOUND) and creates nothing`, async () => {
        const refs = await reachableRefs(e);
        const foreign = await newRow(ref.model, orgB);
        const fd = formData(e.fields(uniq('refused'), { ...refs, [ref.prop]: foreign.id }));
        await expectRefused(cell('action_add', 'fk_to_unreachable'), () => e.upsert(fd), [
          { model: e.entity },
          { model: ref.model, where: { id: foreign.id } },
        ]);
      });

      it(`update pointing ${ref.prop} at a foreign row is refused (NOT_FOUND) and writes nothing`, async () => {
        const refs = await reachableRefs(e);
        const id = await createSingle(e, refs);
        const foreign = await newRow(ref.model, orgB);
        const fd = formData({ id, ...e.fields(uniq('changed'), { ...refs, [ref.prop]: foreign.id }) });
        await expectRefused(cell('action_update', 'fk_to_unreachable'), () => e.upsert(fd), [
          { model: e.entity, where: { id } },
          { model: ref.model, where: { id: foreign.id } },
        ]);
      });

      it(`update re-pointing ${ref.prop} away from a foreign row is refused (PERMISSION_DENIED)`, async () => {
        const refs = await reachableRefs(e);
        const id = await createSingle(e, refs);
        await updateRow(ref.model, refs[ref.prop], { organization_id: orgB });
        const reachable = await newRow(ref.model, orgA);
        const fd = formData({ id, ...e.fields(uniq('changed'), { ...refs, [ref.prop]: reachable.id }) });
        await expectRefused(cell('action_update', 'fk_away_unreachable'), () => e.upsert(fd), [{ model: e.entity, where: { id } }]);
      });

      if (ref.optional) {
        it(`update clearing ${ref.prop} that holds a foreign row is refused (PERMISSION_DENIED)`, async () => {
          const refs = await reachableRefs(e);
          const id = await createSingle(e, refs);
          await updateRow(ref.model, refs[ref.prop], { organization_id: orgB });
          const fd = formData({ id, ...e.fields(uniq('changed'), { ...refs, [ref.prop]: null }) });
          await expectRefused(cell('action_update', 'fk_null_unreachable'), () => e.upsert(fd), [{ model: e.entity, where: { id } }]);
        });
      }

      it(`delete of a record whose ${ref.prop} sits in a foreign org is refused (PERMISSION_DENIED) and keeps it`, async () => {
        const refs = await reachableRefs(e);
        const id = await createSingle(e, refs);
        await updateRow(ref.model, refs[ref.prop], { organization_id: orgB });
        await expectRefused(cell('action_delete', 'fk_delete_unreachable'), () => e.remove([id]), [{ model: e.entity, where: { id } }]);
      });

      it(`update that keeps the foreign ${ref.prop} unchanged is saved`, async () => {
        const refs = await reachableRefs(e);
        const id = await createSingle(e, refs);
        await updateRow(ref.model, refs[ref.prop], { organization_id: orgB });
        const key = uniq('kept');
        await expectSaved(() => e.upsert(formData({ id, ...e.fields(key, refs) })));
        const row = await db[e.entity].findFirst({ where: { id } });
        expect(row?.[e.key]).toBe(key);
        expect(row?.[ref.prop]).toBe(refs[ref.prop]);
      });
    }
  });
}

// --- sx_ticket: inline child rows and to-many sets --------------------------------------------------------------

type Line = { id?: string; label: string; sx_account_id: string; sx_backup_account_id: string | null };
type Refs = { account: string; backup: string | null; tags: string[]; notes: string[]; lines: Line[] };

function ticketFields(title: string, r: Refs, id?: string): Fields {
  return {
    ...(id ? { id } : {}),
    title,
    organization_id: orgA,
    sx_account_id: r.account,
    sx_backup_account_id: r.backup ?? '',
    'tag[]': r.tags.map((t) => JSON.stringify({ id: t })),
    'sx_note[]': r.notes.map((n) => JSON.stringify({ id: n })),
    'sx_ticket_line[]': r.lines.map((l) => JSON.stringify(l)),
  };
}

const ticketSnap = (id: string): Snap => ({
  model: 'sx_ticket',
  where: { id },
  include: {
    tags: { select: { id: true }, orderBy: { id: 'asc' } },
    sx_notes: { select: { id: true }, orderBy: { id: 'asc' } },
    sx_ticket_lines: { orderBy: { id: 'asc' } },
  },
});

async function baseRefs(): Promise<Refs> {
  const account = (await newAccount(orgA)).id;
  const backup = (await newAccount(orgA)).id;
  const tag = (await newRow('sx_tag', orgA)).id;
  const note = (await newRow('sx_note', orgA)).id;
  return {
    account,
    backup,
    tags: [tag],
    notes: [note],
    lines: [
      { label: 'L0', sx_account_id: account, sx_backup_account_id: backup },
      { label: 'L1', sx_account_id: account, sx_backup_account_id: null },
    ],
  };
}

async function createTicket(refs: Refs): Promise<{ id: string; refs: Refs }> {
  const title = uniq('ticket');
  await expectSaved(() => ticketActions.upsertSxTicket(formData(ticketFields(title, refs))));
  const row = await prisma.sx_ticket.findFirstOrThrow({ where: { title }, include: { sx_ticket_lines: true } });
  const lines = refs.lines.map((l) => ({ ...l, id: row.sx_ticket_lines.find((x) => x.label === l.label)?.id }));
  return { id: row.id, refs: { ...refs, lines } };
}

type TicketShape = 'many_to_one_required' | 'many_to_one_optional' | 'inline_child_required' | 'inline_child_optional' | 'many_to_many' | 'one_to_many';
const withLine0 = (r: Refs, patch: Partial<Line>): Refs => ({ ...r, lines: [{ ...r.lines[0], ...patch }, r.lines[1]] });
const TICKET_SHAPES: Record<TicketShape, { model: string; point(r: Refs, id: string): Refs; clear?(r: Refs): Refs; drop?(r: Refs, id: string): Refs }> = {
  many_to_one_required: { model: 'sx_account', point: (r, id) => ({ ...r, account: id }) },
  many_to_one_optional: { model: 'sx_account', point: (r, id) => ({ ...r, backup: id }), clear: (r) => ({ ...r, backup: null }) },
  inline_child_required: {
    model: 'sx_account',
    point: (r, id) => withLine0(r, { sx_account_id: id }),
    drop: (r) => ({ ...r, lines: [r.lines[1]] }),
  },
  inline_child_optional: {
    model: 'sx_account',
    point: (r, id) => withLine0(r, { sx_backup_account_id: id }),
    clear: (r) => withLine0(r, { sx_backup_account_id: null }),
    drop: (r) => ({ ...r, lines: [r.lines[1]] }),
  },
  many_to_many: {
    model: 'sx_tag',
    point: (r, id) => ({ ...r, tags: [...r.tags, id] }),
    drop: (r, id) => ({ ...r, tags: r.tags.filter((t) => t !== id) }),
  },
  one_to_many: {
    model: 'sx_note',
    point: (r, id) => ({ ...r, notes: [...r.notes, id] }),
    drop: (r, id) => ({ ...r, notes: r.notes.filter((n) => n !== id) }),
  },
};

async function ticketHoldingUnreachable(shape: TicketShape): Promise<{ id: string; refs: Refs; held: string }> {
  const spec = TICKET_SHAPES[shape];
  const base = await baseRefs();
  const held = (await newRow(spec.model, orgA)).id;
  const t = await createTicket(spec.point(base, held));
  await updateRow(spec.model, held, { organization_id: orgB });
  return { ...t, held };
}

const tcell = (operation: string, kase: string, shape: TicketShape): Cell => ({ entity: 'sx_ticket', operation, case: kase, fk_shape: shape });

// security-cell: entity=sx_ticket operation=action_add case=fk_to_unreachable fk_shape=many_to_one_required
// security-cell: entity=sx_ticket operation=action_add case=fk_to_unreachable fk_shape=many_to_one_optional
// security-cell: entity=sx_ticket operation=action_add case=fk_to_unreachable fk_shape=inline_child_required
// security-cell: entity=sx_ticket operation=action_add case=fk_to_unreachable fk_shape=inline_child_optional
// security-cell: entity=sx_ticket operation=action_add case=fk_to_unreachable fk_shape=many_to_many
// security-cell: entity=sx_ticket operation=action_add case=fk_to_unreachable fk_shape=one_to_many
// security-cell: entity=sx_ticket operation=action_update case=fk_to_unreachable fk_shape=many_to_one_required
// security-cell: entity=sx_ticket operation=action_update case=fk_to_unreachable fk_shape=many_to_one_optional
// security-cell: entity=sx_ticket operation=action_update case=fk_to_unreachable fk_shape=inline_child_required
// security-cell: entity=sx_ticket operation=action_update case=fk_to_unreachable fk_shape=inline_child_optional
// security-cell: entity=sx_ticket operation=action_update case=fk_to_unreachable fk_shape=many_to_many
// security-cell: entity=sx_ticket operation=action_update case=fk_to_unreachable fk_shape=one_to_many
// security-cell: entity=sx_ticket operation=action_update case=fk_away_unreachable fk_shape=many_to_one_required
// security-cell: entity=sx_ticket operation=action_update case=fk_away_unreachable fk_shape=many_to_one_optional
// security-cell: entity=sx_ticket operation=action_update case=fk_away_unreachable fk_shape=inline_child_required
// security-cell: entity=sx_ticket operation=action_update case=fk_away_unreachable fk_shape=inline_child_optional
// security-cell: entity=sx_ticket operation=action_update case=fk_null_unreachable fk_shape=many_to_one_optional
// security-cell: entity=sx_ticket operation=action_update case=fk_null_unreachable fk_shape=inline_child_optional
// security-cell: entity=sx_ticket operation=action_update case=fk_drop_unreachable fk_shape=inline_child_required
// security-cell: entity=sx_ticket operation=action_update case=fk_drop_unreachable fk_shape=inline_child_optional
// security-cell: entity=sx_ticket operation=action_update case=fk_drop_unreachable fk_shape=many_to_many
// security-cell: entity=sx_ticket operation=action_update case=fk_drop_unreachable fk_shape=one_to_many
// security-cell: entity=sx_ticket operation=action_delete case=fk_delete_unreachable fk_shape=many_to_one_required
// security-cell: entity=sx_ticket operation=action_delete case=fk_delete_unreachable fk_shape=many_to_one_optional
// security-cell: entity=sx_ticket operation=action_delete case=fk_delete_unreachable fk_shape=inline_child_required
// security-cell: entity=sx_ticket operation=action_delete case=fk_delete_unreachable fk_shape=inline_child_optional
// security-cell: entity=sx_ticket operation=action_delete case=fk_delete_unreachable fk_shape=many_to_many
// security-cell: entity=sx_ticket operation=action_delete case=fk_delete_unreachable fk_shape=one_to_many
describe('sx_ticket Server Actions: every reference shape against a row of another organization', () => {
  for (const shape of Object.keys(TICKET_SHAPES) as TicketShape[]) {
    const spec = TICKET_SHAPES[shape];

    it(`add with a ${shape} reference to a foreign row is refused (NOT_FOUND) and creates nothing`, async () => {
      const base = await baseRefs();
      const foreign = await newRow(spec.model, orgB);
      const fd = formData(ticketFields(uniq('refused'), spec.point(base, foreign.id)));
      await expectRefused(tcell('action_add', 'fk_to_unreachable', shape), () => ticketActions.upsertSxTicket(fd), [
        { model: 'sx_ticket' },
        { model: spec.model, where: { id: foreign.id } },
      ]);
    });

    it(`update pointing ${shape} at a foreign row is refused (NOT_FOUND) and writes nothing`, async () => {
      const t = await createTicket(await baseRefs());
      const foreign = await newRow(spec.model, orgB);
      const fd = formData(ticketFields('changed', spec.point(t.refs, foreign.id), t.id));
      await expectRefused(tcell('action_update', 'fk_to_unreachable', shape), () => ticketActions.upsertSxTicket(fd), [
        ticketSnap(t.id),
        { model: spec.model, where: { id: foreign.id } },
      ]);
    });

    if (shape !== 'many_to_many' && shape !== 'one_to_many') {
      it(`update re-pointing ${shape} away from a foreign row is refused (PERMISSION_DENIED)`, async () => {
        const t = await ticketHoldingUnreachable(shape);
        const reachable = await newRow(spec.model, orgA);
        const fd = formData(ticketFields('changed', spec.point(t.refs, reachable.id), t.id));
        await expectRefused(tcell('action_update', 'fk_away_unreachable', shape), () => ticketActions.upsertSxTicket(fd), [ticketSnap(t.id)]);
      });
    }

    if (spec.clear) {
      it(`update clearing ${shape} that holds a foreign row is refused (PERMISSION_DENIED)`, async () => {
        const t = await ticketHoldingUnreachable(shape);
        const fd = formData(ticketFields('changed', spec.clear!(t.refs), t.id));
        await expectRefused(tcell('action_update', 'fk_null_unreachable', shape), () => ticketActions.upsertSxTicket(fd), [ticketSnap(t.id)]);
      });
    }

    if (spec.drop) {
      it(`update removing the ${shape} entry that holds a foreign row is refused (PERMISSION_DENIED)`, async () => {
        const t = await ticketHoldingUnreachable(shape);
        const fd = formData(ticketFields('changed', spec.drop!(t.refs, t.held), t.id));
        await expectRefused(tcell('action_update', 'fk_drop_unreachable', shape), () => ticketActions.upsertSxTicket(fd), [
          ticketSnap(t.id),
          { model: spec.model, where: { id: t.held } },
        ]);
      });
    }

    it(`delete of a ticket whose ${shape} holds a foreign row is refused (PERMISSION_DENIED) and keeps it`, async () => {
      const t = await ticketHoldingUnreachable(shape);
      await expectRefused(tcell('action_delete', 'fk_delete_unreachable', shape), () => ticketActions.removeSxTicket([t.id]), [
        ticketSnap(t.id),
        { model: spec.model, where: { id: t.held } },
      ]);
    });

    it(`update that keeps the ${shape} foreign row unchanged is saved`, async () => {
      const t = await ticketHoldingUnreachable(shape);
      const title = uniq('kept');
      await expectSaved(() => ticketActions.upsertSxTicket(formData(ticketFields(title, t.refs, t.id))));
      const row = await prisma.sx_ticket.findFirstOrThrow({ where: { id: t.id }, include: { tags: true, sx_notes: true, sx_ticket_lines: true } });
      expect(row.title).toBe(title);
      expect(JSON.stringify(row)).toContain(t.held);
    });
  }
});

// --- Creator / Assignee scope through the actions ---------------------------------------------------------------

describe('sx_ticket Server Actions: references outside the actor\'s Creator / Assignee read scope', () => {
  // The scoped actor writes every ticket of organization A, reads sx_account only where assigned to it and
  // sx_tag / sx_note only where it created them; "theirs" rows are created by another user.
  let actor = '';
  const rows: Record<string, string> = {};

  beforeAll(async () => {
    actor = (
      await seedScopedActor('flow_scope', [orgA], [
        { entity: 'sx_ticket', scope: 'general', flags: { create: true, read: true, update: true, delete: true } },
        { entity: 'organization', scope: 'general', flags: { read: true } },
        { entity: 'sx_account', scope: 'Assignee', flags: { read: true } },
        { entity: 'sx_tag', scope: 'Creator', flags: { read: true } },
        { entity: 'sx_note', scope: 'Creator', flags: { read: true } },
      ])
    ).userId;
  });

  beforeEach(async () => {
    rows.accMine = (await newAccount(orgA, { assignee_id: actor })).id;
    rows.accMine2 = (await newAccount(orgA, { assignee_id: actor })).id;
    rows.accTheirs = (await newAccount(orgA)).id;
    rows.tagMine = (await newRow('sx_tag', orgA, audit(actor))).id;
    rows.tagTheirs = (await newRow('sx_tag', orgA)).id;
    rows.noteMine = (await newRow('sx_note', orgA, audit(actor))).id;
    rows.noteTheirs = (await newRow('sx_note', orgA)).id;
  });

  const mineLine = (): Line => ({ label: 'L0', sx_account_id: rows.accMine, sx_backup_account_id: null });

  const mixed = (): Refs => ({
    account: rows.accMine,
    backup: rows.accTheirs,
    tags: [rows.tagMine, rows.tagTheirs],
    notes: [rows.noteMine, rows.noteTheirs],
    lines: [
      { label: 'L0', sx_account_id: rows.accMine, sx_backup_account_id: rows.accTheirs },
      { label: 'L1', sx_account_id: rows.accMine, sx_backup_account_id: null },
    ],
  });

  // security-cell: entity=sx_ticket operation=action_add case=fk_to_unreachable fk_shape=many_to_many
  it('add with one out-of-scope tag among in-scope ones is refused (NOT_FOUND)', async () => {
    const refs: Refs = { ...mixed(), backup: rows.accMine2, tags: [rows.tagMine, rows.tagTheirs], notes: [rows.noteMine], lines: [mineLine()] };
    const fd = formData(ticketFields(uniq('refused'), refs));
    await expectRefused(tcell('action_add', 'fk_to_unreachable', 'many_to_many'), () => ticketActions.upsertSxTicket(fd), [{ model: 'sx_ticket' }], actor);
  });

  it('keeps out-of-scope members unchanged and removes only in-scope ones', async () => {
    const t = await createTicket(mixed());
    const refs = { ...t.refs, tags: [rows.tagTheirs], notes: [rows.noteTheirs], lines: [t.refs.lines[0]] };
    await expectSaved(() => ticketActions.upsertSxTicket(formData(ticketFields('trimmed', refs, t.id))), actor);
    const row = await prisma.sx_ticket.findFirstOrThrow({ where: { id: t.id }, include: { tags: true, sx_notes: true, sx_ticket_lines: true } });
    expect(row.tags.map((x) => x.id)).toEqual([rows.tagTheirs]);
    expect(row.sx_notes.map((x) => x.id)).toEqual([rows.noteTheirs]);
    expect(row.sx_ticket_lines.map((x) => x.label)).toEqual(['L0']);
  });

  // security-cell: entity=sx_ticket operation=action_update case=fk_drop_unreachable fk_shape=many_to_many
  // security-cell: entity=sx_ticket operation=action_update case=fk_drop_unreachable fk_shape=one_to_many
  // security-cell: entity=sx_ticket operation=action_update case=fk_null_unreachable fk_shape=many_to_one_optional
  for (const [kase, shape, mutate] of [
    ['fk_drop_unreachable', 'many_to_many', (r: Refs) => ({ ...r, tags: [rows.tagMine] })],
    ['fk_drop_unreachable', 'one_to_many', (r: Refs) => ({ ...r, notes: [rows.noteMine] })],
    ['fk_null_unreachable', 'many_to_one_optional', (r: Refs) => ({ ...r, backup: null })],
  ] as Array<[string, TicketShape, (r: Refs) => Refs]>) {
    it(`update that ${kase === 'fk_null_unreachable' ? 'clears' : 'removes'} the out-of-scope ${shape} entry is refused (PERMISSION_DENIED)`, async () => {
      const t = await createTicket(mixed());
      const fd = formData(ticketFields('changed', mutate(t.refs), t.id));
      await expectRefused(tcell('action_update', kase, shape), () => ticketActions.upsertSxTicket(fd), [ticketSnap(t.id)], actor);
    });
  }

  // security-cell: entity=sx_ticket operation=action_delete case=fk_delete_unreachable fk_shape=one_to_many
  it('delete of a ticket with an out-of-scope note is refused (PERMISSION_DENIED)', async () => {
    const t = await createTicket({ ...mixed(), backup: rows.accMine2, tags: [rows.tagMine], lines: [mineLine()] });
    await expectRefused(tcell('action_delete', 'fk_delete_unreachable', 'one_to_many'), () => ticketActions.removeSxTicket([t.id]), [ticketSnap(t.id)], actor);
  });
});
