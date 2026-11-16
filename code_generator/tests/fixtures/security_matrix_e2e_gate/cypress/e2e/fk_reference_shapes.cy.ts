// Every kind of reference a write can carry, tested against a row the actor cannot reach (Issue #1324).
//
// The rule (docs/knowledge/multi-tenancy-and-permissions.md, "Foreign-key reachability") is the same for
// every shape, single references and to-many sets alike:
//   * writing a reference to an unreachable or missing row, or adding one to a set   -> 404, nothing written
//   * moving a reference away from an unreachable row, clearing it, removing it from
//     a set, or dropping the inline child row that holds it                         -> 403, nothing written
//   * deleting a record that holds such a reference                                 -> 403, record kept
//   * leaving such a reference unchanged (or leaving the set out of a PUT)          -> allowed
// "Unreachable" is a row of another organization, or a row outside the actor's Creator / Assignee read scope
// (the scoped-actor block at the end: some members of one set are reachable and others are not).
//
// Every denial re-reads the database (the record with its set members and inline child rows, and the
// referenced row) and asserts nothing changed. The REST cells of sx_ticket (many-to-one required and optional,
// inline child required and optional, many-to-many, one-to-many) and of sx_profile (one-to-one optional) are
// claimed below; the required one-to-one of sx_profile and the many-to-one of sx_task are the primary display
// field there, claimed by the generated G3.8-G3.15 tests. Server Action cells stay in the allowlist (#1231).
import { seedRow, seedScopedActor, updateRow, type ScopedGrant, type SecurityActor } from '../../support/security_helpers';
import { TEST_CREDENTIALS } from '../../support/test-credentials';

type Row = { id: string } & Record<string, unknown>;
type Line = { id?: string; label: string; sx_account_id: string; sx_backup_account_id: string | null };
type Refs = { account: string; backup: string | null; tags: string[]; notes: string[]; lines: Line[] };
type Snap = { model: string; where?: Record<string, unknown>; include?: Record<string, unknown> };
type Cell = { entity: string; operation: string; case: string; fk_shape: string };

const TICKET_API = '/api/sx_ticket';
const PROFILE_API = '/api/sx_profile';

let adminId = '';
// The actor of every write in the organization-B blocks: a member of organization A only, with general rights on
// every fixture entity (stated here, not taken from the seeded Administrator role, which does not cover sx_tag and
// sx_note). A fresh one per test keeps each actor far below the per-actor `api:write` rate limit.
let writer: SecurityActor;
const WRITER_GRANTS: ScopedGrant[] = [
  ...['sx_ticket', 'sx_account', 'sx_tag', 'sx_note', 'sx_profile', 'sx_split', 'sx_task', 'sx_entry'].map((entity): ScopedGrant => ({
    entity,
    scope: 'general',
    flags: { create: true, read: true, update: true, delete: true, import: true },
  })),
  { entity: 'organization', scope: 'general', flags: { read: true } },
];

function freshWriter() {
  cy.then(() =>
    seedScopedActor('writer', [orgA], WRITER_GRANTS).then((a) => {
      writer = a;
    }),
  );
}
let orgA = '';
let orgB = '';
let seq = 0;
const uniq = (prefix: string) => `${prefix} ${Date.now()}-${++seq}`;

function audit(creatorId = adminId) {
  return { creator_id: creatorId, updater_id: creatorId };
}

/** A fresh database with organizations A and B; the writer and the scoped actor belong to A only. */
function seedWorld() {
  cy.task('db:reset');
  cy.task('db:seed');
  cy.task('db:grantAllPermissions');
  cy.task<Row[]>('security:snapshot', { model: 'user', where: { email: TEST_CREDENTIALS.email } }).then(([admin]) => {
    adminId = admin.id;
    seedRow<Row>('organization', { name: uniq('FK org A'), users: { connect: [{ id: adminId }] }, ...audit() }).then((o) => {
      orgA = o.id;
    });
    seedRow<Row>('organization', { name: uniq('FK org B'), ...audit() }).then((o) => {
      orgB = o.id;
    });
  });
}

// --- rows of the referenced entities -------------------------------------------------------------------------

function newAccount(org: string, extra: Record<string, unknown> = {}): Cypress.Chainable<Row> {
  return seedRow<Row>('commentable', {}).then((c) =>
    seedRow<Row>('sx_account', { name: uniq('account'), organization_id: org, commentable_id: c.id, ...audit(), ...extra }),
  );
}

function newRow(model: string, org: string, extra: Record<string, unknown> = {}): Cypress.Chainable<Row> {
  if (model === 'sx_account') return newAccount(org, extra);
  if (model === 'sx_split') return seedRow<Row>('sx_split', { title: uniq('split'), organization_id: org, ...audit(), ...extra });
  return seedRow<Row>(model, { name: uniq(model), organization_id: org, ...audit(), ...extra });
}

// --- requests and re-reads -----------------------------------------------------------------------------------

function readAll(specs: Snap[]): Cypress.Chainable<unknown[]> {
  const out: unknown[] = [];
  specs.forEach((spec) => cy.task('security:snapshot', spec).then((rows) => { out.push(rows); }));
  return cy.wrap(out);
}

type Refusal = {
  cell: Cell;
  /** The status the matrix declares for the cell's case: the response status, or the bulk item's meaning. */
  status: 403 | 404;
  actor?: SecurityActor;
  method: 'POST' | 'PUT' | 'DELETE';
  url: string;
  body?: unknown;
  /** Rows re-read before and after: the denied write must leave them unchanged. */
  keep: Snap[];
  bulk?: boolean;
};

/**
 * Sends a write that must be refused and proves it was: the claimed cell exists in the manifest with this
 * status, the response is exactly that status (a bulk route answers 207 with the item failed), and every row
 * of `keep` reads the same afterwards.
 */
function expectRefused(r: Refusal) {
  cy.task('security:checkCell', { cell: r.cell, status: r.status });
  readAll(r.keep).then((before) => {
    const snapshotBefore = JSON.stringify(before);
    cy.request({
      method: r.method,
      url: r.url,
      headers: { 'X-API-Key': (r.actor ?? writer).apiKey },
      body: r.body as Cypress.RequestBody,
      failOnStatusCode: false,
    }).then((res) => {
      if (r.bulk) {
        expect(res.status, `${r.method} ${r.url}`).to.eq(207);
        expect(res.body.summary.succeeded).to.eq(0);
        expect(res.body.results[0].success).to.eq(false);
        const pattern = r.status === 404 ? /^Not found/ : /not accessible|^Access denied/;
        expect(res.body.results[0].error).to.match(pattern);
      } else {
        expect(res.status, `${r.method} ${r.url}`).to.eq(r.status);
      }
    });
    readAll(r.keep).then((after) => {
      expect(JSON.stringify(after), 'rows re-read after the refused write').to.eq(snapshotBefore);
    });
  });
}

function expectAccepted(method: 'PUT' | 'POST', url: string, body: unknown, actor: SecurityActor = writer) {
  return cy
    .request({ method, url, headers: { 'X-API-Key': actor.apiKey }, body: body as Cypress.RequestBody, failOnStatusCode: false })
    .then((res) => {
      expect(res.status, `${method} ${url}: ${JSON.stringify(res.body)}`).to.be.oneOf([200, 201, 207]);
      if (res.status === 207) expect(res.body.summary.failed, JSON.stringify(res.body)).to.eq(0);
      return res;
    });
}

// --- sx_ticket -----------------------------------------------------------------------------------------------

const ticketSnap = (id: string): Snap => ({
  model: 'sx_ticket',
  where: { id },
  include: {
    tags: { select: { id: true }, orderBy: { id: 'asc' } },
    sx_notes: { select: { id: true }, orderBy: { id: 'asc' } },
    sx_ticket_lines: { orderBy: { id: 'asc' } },
  },
});
const ALL_TICKETS: Snap = { model: 'sx_ticket', include: { tags: { select: { id: true } }, sx_notes: { select: { id: true } } } };

function ticketBody(title: string, r: Refs) {
  return {
    title,
    organization_id: orgA,
    sx_account_id: r.account,
    sx_backup_account_id: r.backup,
    tags_ids: r.tags,
    sxNotes_ids: r.notes,
    sx_ticket_lines: r.lines,
  };
}

/** Fresh reachable rows (organization A) for every reference of a ticket; line L0 carries the inline references. */
function baseRefs(): Cypress.Chainable<Refs> {
  const ids: Record<string, string> = {};
  newAccount(orgA).then((r) => { ids.account = r.id; });
  newAccount(orgA).then((r) => { ids.backup = r.id; });
  newRow('sx_tag', orgA).then((r) => { ids.tag = r.id; });
  newRow('sx_note', orgA).then((r) => { ids.note = r.id; });
  return cy.then((): Refs => ({
    account: ids.account,
    backup: ids.backup,
    tags: [ids.tag],
    notes: [ids.note],
    lines: [
      { label: 'L0', sx_account_id: ids.account, sx_backup_account_id: ids.backup },
      { label: 'L1', sx_account_id: ids.account, sx_backup_account_id: null },
    ],
  }));
}

/** Creates a ticket as the writer and returns it with the ids of its inline rows filled in. */
function createTicket(refs: Refs, actor: SecurityActor = writer): Cypress.Chainable<{ id: string; refs: Refs }> {
  return expectAccepted('POST', TICKET_API, ticketBody(uniq('ticket'), refs), actor).then((res) => {
    const id = res.body.id as string;
    return cy.task<Line[]>('security:snapshot', { model: 'sx_ticket_line', where: { sx_ticket_id: id } }).then((rows): { id: string; refs: Refs } => {
      const lines = refs.lines.map((l): Line => {
        const row = rows.find((x) => x.label === l.label);
        return { id: row?.id, label: l.label, sx_account_id: l.sx_account_id, sx_backup_account_id: l.sx_backup_account_id };
      });
      return { id, refs: { ...refs, lines } };
    });
  });
}

type TicketShape =
  | 'many_to_one_required'
  | 'many_to_one_optional'
  | 'inline_child_required'
  | 'inline_child_optional'
  | 'many_to_many'
  | 'one_to_many';

type ShapeSpec = {
  /** Model of the referenced rows. */
  model: string;
  /** Points the shape at `id` (for a set: adds `id` as a member). */
  point(r: Refs, id: string): Refs;
  /** Clears the reference (optional single shapes). */
  clear?(r: Refs): Refs;
  /** Removes the member `id` from the set, or drops the inline row that holds the reference. */
  drop?(r: Refs, id: string): Refs;
};

const withLine0 = (r: Refs, patch: Partial<Line>): Refs => ({ ...r, lines: [{ ...r.lines[0], ...patch }, r.lines[1]] });

const TICKET_SHAPES: Record<TicketShape, ShapeSpec> = {
  many_to_one_required: { model: 'sx_account', point: (r, id) => ({ ...r, account: id }) },
  many_to_one_optional: {
    model: 'sx_account',
    point: (r, id) => ({ ...r, backup: id }),
    clear: (r) => ({ ...r, backup: null }),
  },
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

const cell = (entity: string, operation: string, kase: string, shape: string): Cell => ({
  entity,
  operation,
  case: kase,
  fk_shape: shape,
});

/**
 * A ticket whose `shape` holds a row that the writer can no longer reach: the row is referenced
 * while it is in organization A, then moved into organization B (as G3.12 does for the primary field).
 */
function ticketHoldingUnreachable(shape: TicketShape): Cypress.Chainable<{ id: string; refs: Refs; held: Row }> {
  const spec = TICKET_SHAPES[shape];
  return baseRefs().then((base) =>
    newRow(spec.model, orgA).then((held) =>
      createTicket(spec.point(base, held.id)).then((t) =>
        updateRow(spec.model, held.id, { organization_id: orgB }).then(() => ({ ...t, held })),
      ),
    ),
  );
}

const SHAPE_NAMES = Object.keys(TICKET_SHAPES) as TicketShape[];

describe('sx_ticket: a reference to a row of another organization', () => {
  before(() => seedWorld());
  beforeEach(() => freshWriter());

  // security-cell: entity=sx_ticket operation=create case=fk_to_unreachable fk_shape=many_to_one_required
  // security-cell: entity=sx_ticket operation=create case=fk_to_unreachable fk_shape=many_to_one_optional
  // security-cell: entity=sx_ticket operation=create case=fk_to_unreachable fk_shape=inline_child_required
  // security-cell: entity=sx_ticket operation=create case=fk_to_unreachable fk_shape=inline_child_optional
  // security-cell: entity=sx_ticket operation=create case=fk_to_unreachable fk_shape=many_to_many
  // security-cell: entity=sx_ticket operation=create case=fk_to_unreachable fk_shape=one_to_many
  // security-cell: entity=sx_ticket operation=bulk_create case=fk_to_unreachable fk_shape=many_to_one_required
  // security-cell: entity=sx_ticket operation=bulk_create case=fk_to_unreachable fk_shape=many_to_one_optional
  // security-cell: entity=sx_ticket operation=bulk_create case=fk_to_unreachable fk_shape=inline_child_required
  // security-cell: entity=sx_ticket operation=bulk_create case=fk_to_unreachable fk_shape=inline_child_optional
  // security-cell: entity=sx_ticket operation=bulk_create case=fk_to_unreachable fk_shape=many_to_many
  // security-cell: entity=sx_ticket operation=bulk_create case=fk_to_unreachable fk_shape=one_to_many
  SHAPE_NAMES.forEach((shape) => {
    const spec = TICKET_SHAPES[shape];
    it(`create with a ${shape} reference to a foreign row returns 404 and creates nothing`, () => {
      baseRefs().then((base) => {
        newRow(spec.model, orgB).then((foreign) => {
          expectRefused({
            cell: cell('sx_ticket', 'create', 'fk_to_unreachable', shape),
            status: 404,
            method: 'POST',
            url: TICKET_API,
            body: ticketBody(uniq('refused'), spec.point(base, foreign.id)),
            keep: [ALL_TICKETS, { model: spec.model, where: { id: foreign.id } }],
          });
        });
      });
    });

    it(`bulk create with a ${shape} reference to a foreign row reports Not found and creates nothing`, () => {
      baseRefs().then((base) => {
        newRow(spec.model, orgB).then((foreign) => {
          expectRefused({
            cell: cell('sx_ticket', 'bulk_create', 'fk_to_unreachable', shape),
            status: 404,
            bulk: true,
            method: 'POST',
            url: `${TICKET_API}/bulk`,
            body: [ticketBody(uniq('refused'), spec.point(base, foreign.id))],
            keep: [ALL_TICKETS, { model: spec.model, where: { id: foreign.id } }],
          });
        });
      });
    });

    it(`create with a ${shape} reference to a missing row returns 404`, () => {
      baseRefs().then((base) => {
        expectRefused({
          cell: cell('sx_ticket', 'create', 'fk_to_unreachable', shape),
          status: 404,
          method: 'POST',
          url: TICKET_API,
          body: ticketBody(uniq('refused'), spec.point(base, 'c000000000000000000000000missing')),
          keep: [ALL_TICKETS],
        });
      });
    });
  });

  // security-cell: entity=sx_ticket operation=update case=fk_to_unreachable fk_shape=many_to_one_required
  // security-cell: entity=sx_ticket operation=update case=fk_to_unreachable fk_shape=many_to_one_optional
  // security-cell: entity=sx_ticket operation=update case=fk_to_unreachable fk_shape=inline_child_required
  // security-cell: entity=sx_ticket operation=update case=fk_to_unreachable fk_shape=inline_child_optional
  // security-cell: entity=sx_ticket operation=update case=fk_to_unreachable fk_shape=many_to_many
  // security-cell: entity=sx_ticket operation=update case=fk_to_unreachable fk_shape=one_to_many
  // security-cell: entity=sx_ticket operation=bulk_update case=fk_to_unreachable fk_shape=many_to_one_required
  // security-cell: entity=sx_ticket operation=bulk_update case=fk_to_unreachable fk_shape=many_to_one_optional
  // security-cell: entity=sx_ticket operation=bulk_update case=fk_to_unreachable fk_shape=inline_child_required
  // security-cell: entity=sx_ticket operation=bulk_update case=fk_to_unreachable fk_shape=inline_child_optional
  // security-cell: entity=sx_ticket operation=bulk_update case=fk_to_unreachable fk_shape=many_to_many
  // security-cell: entity=sx_ticket operation=bulk_update case=fk_to_unreachable fk_shape=one_to_many
  SHAPE_NAMES.forEach((shape) => {
    const spec = TICKET_SHAPES[shape];
    [false, true].forEach((bulk) => {
      it(`${bulk ? 'bulk ' : ''}update pointing ${shape} at a foreign row is refused with Not found and writes nothing`, () => {
        baseRefs().then((base) => {
          createTicket(base).then((t) => {
            newRow(spec.model, orgB).then((foreign) => {
              const body = ticketBody('changed', spec.point(t.refs, foreign.id));
              expectRefused({
                cell: cell('sx_ticket', bulk ? 'bulk_update' : 'update', 'fk_to_unreachable', shape),
                status: 404,
                bulk,
                method: 'PUT',
                url: bulk ? `${TICKET_API}/bulk` : `${TICKET_API}/${t.id}`,
                body: bulk ? [{ id: t.id, ...body }] : body,
                keep: [ticketSnap(t.id), { model: spec.model, where: { id: foreign.id } }],
              });
            });
          });
        });
      });
    });
  });

  // Moving a single reference (or an inline row's reference) off a row the caller cannot reach.
  // security-cell: entity=sx_ticket operation=update case=fk_away_unreachable fk_shape=many_to_one_required
  // security-cell: entity=sx_ticket operation=update case=fk_away_unreachable fk_shape=many_to_one_optional
  // security-cell: entity=sx_ticket operation=update case=fk_away_unreachable fk_shape=inline_child_required
  // security-cell: entity=sx_ticket operation=update case=fk_away_unreachable fk_shape=inline_child_optional
  // security-cell: entity=sx_ticket operation=bulk_update case=fk_away_unreachable fk_shape=many_to_one_required
  // security-cell: entity=sx_ticket operation=bulk_update case=fk_away_unreachable fk_shape=many_to_one_optional
  // security-cell: entity=sx_ticket operation=bulk_update case=fk_away_unreachable fk_shape=inline_child_required
  // security-cell: entity=sx_ticket operation=bulk_update case=fk_away_unreachable fk_shape=inline_child_optional
  (['many_to_one_required', 'many_to_one_optional', 'inline_child_required', 'inline_child_optional'] as TicketShape[]).forEach((shape) => {
    const spec = TICKET_SHAPES[shape];
    [false, true].forEach((bulk) => {
      it(`${bulk ? 'bulk ' : ''}update re-pointing ${shape} away from a foreign row is refused (403) and writes nothing`, () => {
        ticketHoldingUnreachable(shape).then((t) => {
          newRow(spec.model, orgA).then((reachable) => {
            const body = ticketBody('changed', spec.point(t.refs, reachable.id));
            expectRefused({
              cell: cell('sx_ticket', bulk ? 'bulk_update' : 'update', 'fk_away_unreachable', shape),
              status: 403,
              bulk,
              method: 'PUT',
              url: bulk ? `${TICKET_API}/bulk` : `${TICKET_API}/${t.id}`,
              body: bulk ? [{ id: t.id, ...body }] : body,
              keep: [ticketSnap(t.id), { model: spec.model, where: { id: t.held.id } }],
            });
          });
        });
      });
    });
  });

  // security-cell: entity=sx_ticket operation=update case=fk_null_unreachable fk_shape=many_to_one_optional
  // security-cell: entity=sx_ticket operation=update case=fk_null_unreachable fk_shape=inline_child_optional
  // security-cell: entity=sx_ticket operation=bulk_update case=fk_null_unreachable fk_shape=many_to_one_optional
  // security-cell: entity=sx_ticket operation=bulk_update case=fk_null_unreachable fk_shape=inline_child_optional
  (['many_to_one_optional', 'inline_child_optional'] as TicketShape[]).forEach((shape) => {
    const spec = TICKET_SHAPES[shape];
    [false, true].forEach((bulk) => {
      it(`${bulk ? 'bulk ' : ''}update clearing ${shape} that holds a foreign row is refused (403) and writes nothing`, () => {
        ticketHoldingUnreachable(shape).then((t) => {
          const body = ticketBody('changed', spec.clear!(t.refs));
          expectRefused({
            cell: cell('sx_ticket', bulk ? 'bulk_update' : 'update', 'fk_null_unreachable', shape),
            status: 403,
            bulk,
            method: 'PUT',
            url: bulk ? `${TICKET_API}/bulk` : `${TICKET_API}/${t.id}`,
            body: bulk ? [{ id: t.id, ...body }] : body,
            keep: [ticketSnap(t.id)],
          });
        });
      });
    });
  });

  // Removing a set member, or dropping the inline row, that holds a foreign row.
  // security-cell: entity=sx_ticket operation=update case=fk_drop_unreachable fk_shape=inline_child_required
  // security-cell: entity=sx_ticket operation=update case=fk_drop_unreachable fk_shape=inline_child_optional
  // security-cell: entity=sx_ticket operation=update case=fk_drop_unreachable fk_shape=many_to_many
  // security-cell: entity=sx_ticket operation=update case=fk_drop_unreachable fk_shape=one_to_many
  // security-cell: entity=sx_ticket operation=bulk_update case=fk_drop_unreachable fk_shape=inline_child_required
  // security-cell: entity=sx_ticket operation=bulk_update case=fk_drop_unreachable fk_shape=inline_child_optional
  // security-cell: entity=sx_ticket operation=bulk_update case=fk_drop_unreachable fk_shape=many_to_many
  // security-cell: entity=sx_ticket operation=bulk_update case=fk_drop_unreachable fk_shape=one_to_many
  (['inline_child_required', 'inline_child_optional', 'many_to_many', 'one_to_many'] as TicketShape[]).forEach((shape) => {
    const spec = TICKET_SHAPES[shape];
    [false, true].forEach((bulk) => {
      it(`${bulk ? 'bulk ' : ''}update removing the ${shape} entry that holds a foreign row is refused (403) and writes nothing`, () => {
        ticketHoldingUnreachable(shape).then((t) => {
          const body = ticketBody('changed', spec.drop!(t.refs, t.held.id));
          expectRefused({
            cell: cell('sx_ticket', bulk ? 'bulk_update' : 'update', 'fk_drop_unreachable', shape),
            status: 403,
            bulk,
            method: 'PUT',
            url: bulk ? `${TICKET_API}/bulk` : `${TICKET_API}/${t.id}`,
            body: bulk ? [{ id: t.id, ...body }] : body,
            keep: [ticketSnap(t.id), { model: spec.model, where: { id: t.held.id } }],
          });
        });
      });
    });
  });

  // security-cell: entity=sx_ticket operation=delete case=fk_delete_unreachable fk_shape=many_to_one_required
  // security-cell: entity=sx_ticket operation=delete case=fk_delete_unreachable fk_shape=many_to_one_optional
  // security-cell: entity=sx_ticket operation=delete case=fk_delete_unreachable fk_shape=inline_child_required
  // security-cell: entity=sx_ticket operation=delete case=fk_delete_unreachable fk_shape=inline_child_optional
  // security-cell: entity=sx_ticket operation=delete case=fk_delete_unreachable fk_shape=many_to_many
  // security-cell: entity=sx_ticket operation=delete case=fk_delete_unreachable fk_shape=one_to_many
  // security-cell: entity=sx_ticket operation=bulk_delete case=fk_delete_unreachable fk_shape=many_to_one_required
  // security-cell: entity=sx_ticket operation=bulk_delete case=fk_delete_unreachable fk_shape=many_to_one_optional
  // security-cell: entity=sx_ticket operation=bulk_delete case=fk_delete_unreachable fk_shape=inline_child_required
  // security-cell: entity=sx_ticket operation=bulk_delete case=fk_delete_unreachable fk_shape=inline_child_optional
  // security-cell: entity=sx_ticket operation=bulk_delete case=fk_delete_unreachable fk_shape=many_to_many
  // security-cell: entity=sx_ticket operation=bulk_delete case=fk_delete_unreachable fk_shape=one_to_many
  SHAPE_NAMES.forEach((shape) => {
    const spec = TICKET_SHAPES[shape];
    [false, true].forEach((bulk) => {
      it(`${bulk ? 'bulk ' : ''}delete of a ticket whose ${shape} holds a foreign row is refused (403) and keeps it`, () => {
        ticketHoldingUnreachable(shape).then((t) => {
          expectRefused({
            cell: cell('sx_ticket', bulk ? 'bulk_delete' : 'delete', 'fk_delete_unreachable', shape),
            status: 403,
            bulk,
            method: 'DELETE',
            url: bulk ? `${TICKET_API}/bulk` : `${TICKET_API}/${t.id}`,
            body: bulk ? [{ id: t.id }] : undefined,
            keep: [ticketSnap(t.id), { model: spec.model, where: { id: t.held.id } }],
          });
        });
      });
    });
  });

  // The other direction: a reference the caller cannot reach does not block writes that leave it alone.
  SHAPE_NAMES.forEach((shape) => {
    it(`update that keeps the ${shape} foreign row unchanged succeeds and keeps the reference`, () => {
      ticketHoldingUnreachable(shape).then((t) => {
        const title = uniq('kept');
        expectAccepted('PUT', `${TICKET_API}/${t.id}`, ticketBody(title, t.refs));
        cy.task<Row[]>('security:snapshot', ticketSnap(t.id)).then(([row]) => {
          expect(row.title).to.eq(title);
          expect(JSON.stringify(row)).to.contain(t.held.id);
        });
      });
    });
  });

  (['many_to_many', 'one_to_many'] as TicketShape[]).forEach((shape) => {
    it(`update that leaves the ${shape} set out of the body keeps its foreign member`, () => {
      ticketHoldingUnreachable(shape).then((t) => {
        const body: Record<string, unknown> = ticketBody(uniq('omitted'), t.refs);
        delete body[shape === 'many_to_many' ? 'tags_ids' : 'sxNotes_ids'];
        expectAccepted('PUT', `${TICKET_API}/${t.id}`, body);
        cy.task<Row[]>('security:snapshot', ticketSnap(t.id)).then(([row]) => {
          expect(JSON.stringify(row)).to.contain(t.held.id);
        });
      });
    });
  });
});

// --- sx_profile: the optional one-to-one reference (sx_split_id) ----------------------------------------------

describe('sx_profile: an optional one-to-one reference to a row of another organization', () => {
  before(() => seedWorld());
  beforeEach(() => freshWriter());

  const profileBody = (account: string, split: string | null) => ({
    title: uniq('profile'),
    organization_id: orgA,
    sx_account_id: account,
    sx_split_id: split,
  });
  const profileSnap = (id: string): Snap => ({ model: 'sx_profile', where: { id } });

  /** A profile holding a split that the writer can no longer reach (moved into organization B). */
  function profileHoldingUnreachable(): Cypress.Chainable<{ id: string; account: string; split: string }> {
    return newAccount(orgA).then((account) =>
      newRow('sx_split', orgA).then((split) =>
        expectAccepted('POST', PROFILE_API, profileBody(account.id, split.id)).then((res) =>
          updateRow('sx_split', split.id, { organization_id: orgB }).then(() => ({
            id: res.body.id as string,
            account: account.id,
            split: split.id,
          })),
        ),
      ),
    );
  }

  // security-cell: entity=sx_profile operation=create case=fk_to_unreachable fk_shape=one_to_one_optional
  // security-cell: entity=sx_profile operation=bulk_create case=fk_to_unreachable fk_shape=one_to_one_optional
  [false, true].forEach((bulk) => {
    it(`${bulk ? 'bulk ' : ''}create with a foreign split is refused with Not found and creates nothing`, () => {
      newAccount(orgA).then((account) => {
        newRow('sx_split', orgB).then((foreign) => {
          const body = profileBody(account.id, foreign.id);
          expectRefused({
            cell: cell('sx_profile', bulk ? 'bulk_create' : 'create', 'fk_to_unreachable', 'one_to_one_optional'),
            status: 404,
            bulk,
            method: 'POST',
            url: bulk ? `${PROFILE_API}/bulk` : PROFILE_API,
            body: bulk ? [body] : body,
            keep: [{ model: 'sx_profile' }, { model: 'sx_split', where: { id: foreign.id } }],
          });
        });
      });
    });
  });

  // security-cell: entity=sx_profile operation=update case=fk_to_unreachable fk_shape=one_to_one_optional
  // security-cell: entity=sx_profile operation=bulk_update case=fk_to_unreachable fk_shape=one_to_one_optional
  [false, true].forEach((bulk) => {
    it(`${bulk ? 'bulk ' : ''}update pointing the split at a foreign row is refused with Not found and writes nothing`, () => {
      newAccount(orgA).then((account) => {
        expectAccepted('POST', PROFILE_API, profileBody(account.id, null)).then((res) => {
          const id = res.body.id as string;
          newRow('sx_split', orgB).then((foreign) => {
            const body = { ...profileBody(account.id, foreign.id), title: 'changed' };
            expectRefused({
              cell: cell('sx_profile', bulk ? 'bulk_update' : 'update', 'fk_to_unreachable', 'one_to_one_optional'),
              status: 404,
              bulk,
              method: 'PUT',
              url: bulk ? `${PROFILE_API}/bulk` : `${PROFILE_API}/${id}`,
              body: bulk ? [{ id, ...body }] : body,
              keep: [profileSnap(id)],
            });
          });
        });
      });
    });
  });

  // security-cell: entity=sx_profile operation=update case=fk_away_unreachable fk_shape=one_to_one_optional
  // security-cell: entity=sx_profile operation=bulk_update case=fk_away_unreachable fk_shape=one_to_one_optional
  // security-cell: entity=sx_profile operation=update case=fk_null_unreachable fk_shape=one_to_one_optional
  // security-cell: entity=sx_profile operation=bulk_update case=fk_null_unreachable fk_shape=one_to_one_optional
  (['fk_away_unreachable', 'fk_null_unreachable'] as const).forEach((kase) => {
    [false, true].forEach((bulk) => {
      it(`${bulk ? 'bulk ' : ''}update ${kase === 'fk_away_unreachable' ? 're-pointing' : 'clearing'} a split that sits in a foreign org is refused (403)`, () => {
        profileHoldingUnreachable().then((p) => {
          newRow('sx_split', orgA).then((reachable) => {
            const body = { ...profileBody(p.account, kase === 'fk_away_unreachable' ? reachable.id : null), title: 'changed' };
            expectRefused({
              cell: cell('sx_profile', bulk ? 'bulk_update' : 'update', kase, 'one_to_one_optional'),
              status: 403,
              bulk,
              method: 'PUT',
              url: bulk ? `${PROFILE_API}/bulk` : `${PROFILE_API}/${p.id}`,
              body: bulk ? [{ id: p.id, ...body }] : body,
              keep: [profileSnap(p.id)],
            });
          });
        });
      });
    });
  });

  // security-cell: entity=sx_profile operation=delete case=fk_delete_unreachable fk_shape=one_to_one_optional
  // security-cell: entity=sx_profile operation=bulk_delete case=fk_delete_unreachable fk_shape=one_to_one_optional
  [false, true].forEach((bulk) => {
    it(`${bulk ? 'bulk ' : ''}delete of a profile holding a foreign split is refused (403) and keeps it`, () => {
      profileHoldingUnreachable().then((p) => {
        expectRefused({
          cell: cell('sx_profile', bulk ? 'bulk_delete' : 'delete', 'fk_delete_unreachable', 'one_to_one_optional'),
          status: 403,
          bulk,
          method: 'DELETE',
          url: bulk ? `${PROFILE_API}/bulk` : `${PROFILE_API}/${p.id}`,
          body: bulk ? [{ id: p.id }] : undefined,
          keep: [profileSnap(p.id)],
        });
      });
    });
  });

  it('update that keeps the foreign split unchanged succeeds', () => {
    profileHoldingUnreachable().then((p) => {
      expectAccepted('PUT', `${PROFILE_API}/${p.id}`, { ...profileBody(p.account, p.split), title: 'kept' });
      cy.task<Row[]>('security:snapshot', profileSnap(p.id)).then(([row]) => {
        expect(row.title).to.eq('kept');
        expect(row.sx_split_id).to.eq(p.split);
      });
    });
  });
});

// --- Creator / Assignee scope: some rows of the same organization are reachable, others are not ----------------

describe('sx_ticket: references outside the actor\'s Creator / Assignee read scope', () => {
  // The actor may write every ticket of organization A, reads sx_account only where assigned to it and
  // sx_tag / sx_note only where it created them. Everything below sits in organization A; "theirs" rows are
  // created by the main test user (audit columns), so they exist in the actor's organization and are still unreachable.
  let actor: SecurityActor & { userId: string };
  const rows: Record<string, string> = {};

  before(() => {
    seedWorld();
    cy.then(() =>
      seedScopedActor('fk_scope', [orgA], [
        { entity: 'sx_ticket', scope: 'general', flags: { create: true, read: true, update: true, delete: true } },
        { entity: 'organization', scope: 'general', flags: { read: true } },
        { entity: 'sx_account', scope: 'Assignee', flags: { read: true } },
        { entity: 'sx_tag', scope: 'Creator', flags: { read: true } },
        { entity: 'sx_note', scope: 'Creator', flags: { read: true } },
      ]).then((a) => {
        actor = a;
      }),
    );
  });

  /** One reachable ("mine") and one unreachable ("theirs") row of every referenced entity. */
  function seedScopedRows() {
    cy.then(() => {
      newAccount(orgA, { assignee_id: actor.userId }).then((r) => { rows.accMine = r.id; });
      newAccount(orgA, { assignee_id: actor.userId }).then((r) => { rows.accMine2 = r.id; });
      newAccount(orgA).then((r) => { rows.accTheirs = r.id; });
      newRow('sx_tag', orgA, audit(actor.userId)).then((r) => { rows.tagMine = r.id; });
      newRow('sx_tag', orgA).then((r) => { rows.tagTheirs = r.id; });
      newRow('sx_note', orgA, audit(actor.userId)).then((r) => { rows.noteMine = r.id; });
      newRow('sx_note', orgA).then((r) => { rows.noteTheirs = r.id; });
    });
  }

  const mineOnly = (): Refs => ({
    account: rows.accMine,
    backup: rows.accMine2,
    tags: [rows.tagMine],
    notes: [rows.noteMine],
    lines: [
      { label: 'L0', sx_account_id: rows.accMine, sx_backup_account_id: rows.accMine2 },
      { label: 'L1', sx_account_id: rows.accMine, sx_backup_account_id: null },
    ],
  });

  /** Created by the writer, who reaches everything: half of every set is outside the actor's scope. */
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

  beforeEach(() => {
    freshWriter();
    seedScopedRows();
  });

  it('creates a ticket whose references are all inside the scope', () => {
    cy.then(() => expectAccepted('POST', TICKET_API, ticketBody(uniq('mine'), mineOnly()), actor));
  });

  // security-cell: entity=sx_ticket operation=create case=fk_to_unreachable fk_shape=many_to_one_required
  // security-cell: entity=sx_ticket operation=create case=fk_to_unreachable fk_shape=inline_child_optional
  // security-cell: entity=sx_ticket operation=create case=fk_to_unreachable fk_shape=many_to_many
  // security-cell: entity=sx_ticket operation=create case=fk_to_unreachable fk_shape=one_to_many
  (
    [
      ['many_to_one_required', (r: Refs) => ({ ...r, account: rows.accTheirs })],
      ['inline_child_optional', (r: Refs) => withLine0(r, { sx_backup_account_id: rows.accTheirs })],
      ['many_to_many', (r: Refs) => ({ ...r, tags: [rows.tagMine, rows.tagTheirs] })],
      ['one_to_many', (r: Refs) => ({ ...r, notes: [rows.noteMine, rows.noteTheirs] })],
    ] as Array<[TicketShape, (r: Refs) => Refs]>
  ).forEach(([shape, mutate]) => {
    it(`create with a ${shape} reference outside the scope returns 404 and creates nothing`, () => {
      cy.then(() =>
        expectRefused({
          cell: cell('sx_ticket', 'create', 'fk_to_unreachable', shape),
          status: 404,
          actor,
          method: 'POST',
          url: TICKET_API,
          body: ticketBody(uniq('refused'), mutate(mineOnly())),
          keep: [ALL_TICKETS],
        }),
      );
    });
  });

  it('update that keeps the out-of-scope members and references unchanged succeeds', () => {
    cy.then(() =>
      createTicket(mixed()).then((t) => {
        expectAccepted('PUT', `${TICKET_API}/${t.id}`, ticketBody('kept by the scoped actor', t.refs), actor);
        cy.task<Row[]>('security:snapshot', ticketSnap(t.id)).then(([row]) => {
          expect(row.title).to.eq('kept by the scoped actor');
          const json = JSON.stringify(row);
          [rows.accTheirs, rows.tagTheirs, rows.noteTheirs].forEach((id) => expect(json).to.contain(id));
        });
      }),
    );
  });

  it('update that removes only the in-scope members of each set succeeds', () => {
    cy.then(() =>
      createTicket(mixed()).then((t) => {
        const refs = { ...t.refs, tags: [rows.tagTheirs], notes: [rows.noteTheirs], lines: [t.refs.lines[0]] };
        expectAccepted('PUT', `${TICKET_API}/${t.id}`, ticketBody('trimmed', refs), actor);
        cy.task<Row[]>('security:snapshot', ticketSnap(t.id)).then(([row]) => {
          const r = row as unknown as { tags: Row[]; sx_notes: Row[]; sx_ticket_lines: Row[] };
          expect(r.tags.map((x) => x.id)).to.deep.eq([rows.tagTheirs]);
          expect(r.sx_notes.map((x) => x.id)).to.deep.eq([rows.noteTheirs]);
          expect(r.sx_ticket_lines.map((x) => x.label)).to.deep.eq(['L0']);
        });
      }),
    );
  });

  // security-cell: entity=sx_ticket operation=update case=fk_null_unreachable fk_shape=many_to_one_optional
  // security-cell: entity=sx_ticket operation=update case=fk_drop_unreachable fk_shape=many_to_many
  // security-cell: entity=sx_ticket operation=update case=fk_drop_unreachable fk_shape=one_to_many
  // security-cell: entity=sx_ticket operation=update case=fk_drop_unreachable fk_shape=inline_child_optional
  (
    [
      ['fk_null_unreachable', 'many_to_one_optional', (r: Refs) => ({ ...r, backup: null })],
      ['fk_drop_unreachable', 'many_to_many', (r: Refs) => ({ ...r, tags: [rows.tagMine] })],
      ['fk_drop_unreachable', 'one_to_many', (r: Refs) => ({ ...r, notes: [rows.noteMine] })],
      ['fk_drop_unreachable', 'inline_child_optional', (r: Refs) => ({ ...r, lines: [r.lines[1]] })],
    ] as Array<[string, TicketShape, (r: Refs) => Refs]>
  ).forEach(([kase, shape, mutate]) => {
    it(`update that ${kase === 'fk_null_unreachable' ? 'clears' : 'removes'} the out-of-scope ${shape} entry is refused (403) and writes nothing`, () => {
      cy.then(() =>
        createTicket(mixed()).then((t) => {
          expectRefused({
            cell: cell('sx_ticket', 'update', kase, shape),
            status: 403,
            actor,
            method: 'PUT',
            url: `${TICKET_API}/${t.id}`,
            body: ticketBody('changed', mutate(t.refs)),
            keep: [ticketSnap(t.id)],
          });
        }),
      );
    });
  });

  // security-cell: entity=sx_ticket operation=delete case=fk_delete_unreachable fk_shape=many_to_many
  it('delete of a ticket with an out-of-scope set member is refused (403) and keeps it', () => {
    cy.then(() => {
      const refs = { ...mineOnly(), tags: [rows.tagMine, rows.tagTheirs] };
      createTicket(refs).then((t) => {
        expectRefused({
          cell: cell('sx_ticket', 'delete', 'fk_delete_unreachable', 'many_to_many'),
          status: 403,
          actor,
          method: 'DELETE',
          url: `${TICKET_API}/${t.id}`,
          keep: [ticketSnap(t.id)],
        });
      });
    });
  });

  it('delete of a ticket whose references are all inside the scope succeeds', () => {
    cy.then(() =>
      createTicket(mineOnly()).then((t) => {
        cy.request({ method: 'DELETE', url: `${TICKET_API}/${t.id}`, headers: { 'X-API-Key': actor.apiKey } })
          .its('status')
          .should('eq', 204);
      }),
    );
  });
});

// --- sx_task: a required many-to-one reference that is not the primary display field -------------------------

describe('sx_task: a required reference (not the primary display field) to a row of another organization', () => {
  before(() => seedWorld());
  beforeEach(() => freshWriter());

  const TASK_API = '/api/sx_task';
  const taskBody = (account: string) => ({ title: uniq('task'), status: 'draft', organization_id: orgA, sx_account_id: account });
  const taskSnap = (id: string): Snap => ({ model: 'sx_task', where: { id } });

  /** A task whose account the writer can no longer reach (moved into organization B). */
  function taskHoldingUnreachable(): Cypress.Chainable<{ id: string; account: string }> {
    return newAccount(orgA).then((account) =>
      expectAccepted('POST', TASK_API, taskBody(account.id)).then((res) =>
        updateRow('sx_account', account.id, { organization_id: orgB }).then(() => ({ id: res.body.id as string, account: account.id })),
      ),
    );
  }

  // security-cell: entity=sx_task operation=create case=fk_to_unreachable fk_shape=many_to_one_required
  // security-cell: entity=sx_task operation=bulk_create case=fk_to_unreachable fk_shape=many_to_one_required
  [false, true].forEach((bulk) => {
    it(`${bulk ? 'bulk ' : ''}create with a foreign account is refused with Not found and creates nothing`, () => {
      newAccount(orgB).then((foreign) => {
        const body = taskBody(foreign.id);
        expectRefused({
          cell: cell('sx_task', bulk ? 'bulk_create' : 'create', 'fk_to_unreachable', 'many_to_one_required'),
          status: 404,
          bulk,
          method: 'POST',
          url: bulk ? `${TASK_API}/bulk` : TASK_API,
          body: bulk ? [body] : body,
          keep: [{ model: 'sx_task' }],
        });
      });
    });
  });

  // security-cell: entity=sx_task operation=update case=fk_to_unreachable fk_shape=many_to_one_required
  // security-cell: entity=sx_task operation=bulk_update case=fk_to_unreachable fk_shape=many_to_one_required
  [false, true].forEach((bulk) => {
    it(`${bulk ? 'bulk ' : ''}update pointing the account at a foreign row is refused with Not found and writes nothing`, () => {
      newAccount(orgA).then((account) => {
        expectAccepted('POST', TASK_API, taskBody(account.id)).then((res) => {
          const id = res.body.id as string;
          newAccount(orgB).then((foreign) => {
            const body = taskBody(foreign.id);
            expectRefused({
              cell: cell('sx_task', bulk ? 'bulk_update' : 'update', 'fk_to_unreachable', 'many_to_one_required'),
              status: 404,
              bulk,
              method: 'PUT',
              url: bulk ? `${TASK_API}/bulk` : `${TASK_API}/${id}`,
              body: bulk ? [{ id, ...body }] : body,
              keep: [taskSnap(id)],
            });
          });
        });
      });
    });
  });

  // security-cell: entity=sx_task operation=update case=fk_away_unreachable fk_shape=many_to_one_required
  // security-cell: entity=sx_task operation=bulk_update case=fk_away_unreachable fk_shape=many_to_one_required
  [false, true].forEach((bulk) => {
    it(`${bulk ? 'bulk ' : ''}update re-pointing the account away from a foreign row is refused (403) and writes nothing`, () => {
      taskHoldingUnreachable().then((t) => {
        newAccount(orgA).then((reachable) => {
          const body = taskBody(reachable.id);
          expectRefused({
            cell: cell('sx_task', bulk ? 'bulk_update' : 'update', 'fk_away_unreachable', 'many_to_one_required'),
            status: 403,
            bulk,
            method: 'PUT',
            url: bulk ? `${TASK_API}/bulk` : `${TASK_API}/${t.id}`,
            body: bulk ? [{ id: t.id, ...body }] : body,
            keep: [taskSnap(t.id)],
          });
        });
      });
    });
  });

  // security-cell: entity=sx_task operation=delete case=fk_delete_unreachable fk_shape=many_to_one_required
  // security-cell: entity=sx_task operation=bulk_delete case=fk_delete_unreachable fk_shape=many_to_one_required
  [false, true].forEach((bulk) => {
    it(`${bulk ? 'bulk ' : ''}delete of a task whose account sits in a foreign org is refused (403) and keeps it`, () => {
      taskHoldingUnreachable().then((t) => {
        expectRefused({
          cell: cell('sx_task', bulk ? 'bulk_delete' : 'delete', 'fk_delete_unreachable', 'many_to_one_required'),
          status: 403,
          bulk,
          method: 'DELETE',
          url: bulk ? `${TASK_API}/bulk` : `${TASK_API}/${t.id}`,
          body: bulk ? [{ id: t.id }] : undefined,
          keep: [taskSnap(t.id)],
        });
      });
    });
  });

  it('update that keeps the foreign account unchanged succeeds', () => {
    taskHoldingUnreachable().then((t) => {
      expectAccepted('PUT', `${TASK_API}/${t.id}`, { ...taskBody(t.account), title: 'kept' });
      cy.task<Row[]>('security:snapshot', taskSnap(t.id)).then(([row]) => {
        expect(row.title).to.eq('kept');
        expect(row.sx_account_id).to.eq(t.account);
      });
    });
  });
});

// --- sx_entry: required and optional many-to-one references, REST and CSV import ----------------------------

describe('sx_entry: references to a row of another organization (REST and CSV import)', () => {
  before(() => seedWorld());
  beforeEach(() => freshWriter());

  const ENTRY_API = '/api/sx_entry';
  type EntryRefs = { sx_account_id: string; sx_backup_account_id: string | null };
  const entryBody = (r: EntryRefs, code = uniq('entry')) => ({ code, organization_id: orgA, ...r });
  const entrySnap = (id: string): Snap => ({ model: 'sx_entry', where: { id } });
  const SHAPES = [
    { prop: 'sx_account_id', shape: 'many_to_one_required', optional: false },
    { prop: 'sx_backup_account_id', shape: 'many_to_one_optional', optional: true },
  ] as const;

  function reachableRefs(): Cypress.Chainable<EntryRefs> {
    const ids: Record<string, string> = {};
    newAccount(orgA).then((a) => { ids.a = a.id; });
    newAccount(orgA).then((b) => { ids.b = b.id; });
    return cy.then((): EntryRefs => ({ sx_account_id: ids.a, sx_backup_account_id: ids.b }));
  }

  function createEntry(r: EntryRefs): Cypress.Chainable<string> {
    return expectAccepted('POST', ENTRY_API, entryBody(r)).then((res) => res.body.id as string);
  }

  // security-cell: entity=sx_entry operation=create case=fk_to_unreachable fk_shape=many_to_one_required
  // security-cell: entity=sx_entry operation=create case=fk_to_unreachable fk_shape=many_to_one_optional
  // security-cell: entity=sx_entry operation=bulk_create case=fk_to_unreachable fk_shape=many_to_one_required
  // security-cell: entity=sx_entry operation=bulk_create case=fk_to_unreachable fk_shape=many_to_one_optional
  // security-cell: entity=sx_entry operation=update case=fk_to_unreachable fk_shape=many_to_one_required
  // security-cell: entity=sx_entry operation=update case=fk_to_unreachable fk_shape=many_to_one_optional
  // security-cell: entity=sx_entry operation=bulk_update case=fk_to_unreachable fk_shape=many_to_one_required
  // security-cell: entity=sx_entry operation=bulk_update case=fk_to_unreachable fk_shape=many_to_one_optional
  // security-cell: entity=sx_entry operation=update case=fk_away_unreachable fk_shape=many_to_one_required
  // security-cell: entity=sx_entry operation=update case=fk_away_unreachable fk_shape=many_to_one_optional
  // security-cell: entity=sx_entry operation=bulk_update case=fk_away_unreachable fk_shape=many_to_one_required
  // security-cell: entity=sx_entry operation=bulk_update case=fk_away_unreachable fk_shape=many_to_one_optional
  // security-cell: entity=sx_entry operation=update case=fk_null_unreachable fk_shape=many_to_one_optional
  // security-cell: entity=sx_entry operation=bulk_update case=fk_null_unreachable fk_shape=many_to_one_optional
  // security-cell: entity=sx_entry operation=delete case=fk_delete_unreachable fk_shape=many_to_one_required
  // security-cell: entity=sx_entry operation=delete case=fk_delete_unreachable fk_shape=many_to_one_optional
  // security-cell: entity=sx_entry operation=bulk_delete case=fk_delete_unreachable fk_shape=many_to_one_required
  // security-cell: entity=sx_entry operation=bulk_delete case=fk_delete_unreachable fk_shape=many_to_one_optional
  SHAPES.forEach(({ prop, shape, optional }) => {
    [false, true].forEach((bulk) => {
      it(`${bulk ? 'bulk ' : ''}create with a foreign ${prop} is refused with Not found and creates nothing`, () => {
        reachableRefs().then((r) => {
          newAccount(orgB).then((foreign) => {
            const body = entryBody({ ...r, [prop]: foreign.id });
            expectRefused({
              cell: cell('sx_entry', bulk ? 'bulk_create' : 'create', 'fk_to_unreachable', shape),
              status: 404,
              bulk,
              method: 'POST',
              url: bulk ? `${ENTRY_API}/bulk` : ENTRY_API,
              body: bulk ? [body] : body,
              keep: [{ model: 'sx_entry' }],
            });
          });
        });
      });

      it(`${bulk ? 'bulk ' : ''}update pointing ${prop} at a foreign row is refused with Not found and writes nothing`, () => {
        reachableRefs().then((r) => {
          createEntry(r).then((id) => {
            newAccount(orgB).then((foreign) => {
              const body = entryBody({ ...r, [prop]: foreign.id });
              expectRefused({
                cell: cell('sx_entry', bulk ? 'bulk_update' : 'update', 'fk_to_unreachable', shape),
                status: 404,
                bulk,
                method: 'PUT',
                url: bulk ? `${ENTRY_API}/bulk` : `${ENTRY_API}/${id}`,
                body: bulk ? [{ id, ...body }] : body,
                keep: [entrySnap(id)],
              });
            });
          });
        });
      });

      const leaving = optional ? (['fk_away_unreachable', 'fk_null_unreachable'] as const) : (['fk_away_unreachable'] as const);
      leaving.forEach((kase) => {
        it(`${bulk ? 'bulk ' : ''}update ${kase === 'fk_away_unreachable' ? 're-pointing' : 'clearing'} ${prop} that holds a foreign row is refused (403)`, () => {
          reachableRefs().then((r) => {
            createEntry(r).then((id) => {
              updateRow('sx_account', r[prop] as string, { organization_id: orgB });
              newAccount(orgA).then((reachable) => {
                const body = entryBody({ ...r, [prop]: kase === 'fk_away_unreachable' ? reachable.id : null });
                expectRefused({
                  cell: cell('sx_entry', bulk ? 'bulk_update' : 'update', kase, shape),
                  status: 403,
                  bulk,
                  method: 'PUT',
                  url: bulk ? `${ENTRY_API}/bulk` : `${ENTRY_API}/${id}`,
                  body: bulk ? [{ id, ...body }] : body,
                  keep: [entrySnap(id)],
                });
              });
            });
          });
        });
      });

      it(`${bulk ? 'bulk ' : ''}delete of an entry whose ${prop} sits in a foreign org is refused (403) and keeps it`, () => {
        reachableRefs().then((r) => {
          createEntry(r).then((id) => {
            updateRow('sx_account', r[prop] as string, { organization_id: orgB });
            expectRefused({
              cell: cell('sx_entry', bulk ? 'bulk_delete' : 'delete', 'fk_delete_unreachable', shape),
              status: 403,
              bulk,
              method: 'DELETE',
              url: bulk ? `${ENTRY_API}/bulk` : `${ENTRY_API}/${id}`,
              body: bulk ? [{ id }] : undefined,
              keep: [entrySnap(id)],
            });
          });
        });
      });
    });
  });

  // CSV import resolves a reference by its label within the caller's organizations, then commits each row
  // through addSxEntry, so a label of another organization is not found at the dry run and a row outside the
  // caller's read scope is refused at the commit. Either way the row is reported as NOT_FOUND and not written.
  const csvOf = (accountName: string, backupName: string, code = uniq('csv')) =>
    `code,organization_name,sx_account_name,sx_backup_account_name\n${code},${orgName},${accountName},${backupName}\n`;
  let orgName = '';
  before(() => {
    cy.then(() => cy.task<Row[]>('security:snapshot', { model: 'organization', where: { id: orgA } }).then(([o]) => {
      orgName = o.name as string;
    }));
  });

  /** Dry run, then (if the dry run found nothing wrong) the commit; yields the last response body. */
  function importCsv(actor: SecurityActor, csv: string): Cypress.Chainable<{ summary: { succeeded: number; failed: number }; errors: Array<{ code: string }> }> {
    const send = (body: Record<string, unknown>) =>
      cy.request({ method: 'POST', url: `${ENTRY_API}/import`, headers: { 'X-API-Key': actor.apiKey }, body, failOnStatusCode: false });
    return send({ csv, dryRun: true }).then((dry) => {
      expect(dry.status, JSON.stringify(dry.body)).to.eq(200);
      if (dry.body.errors.length > 0) return dry.body;
      return send({ csv, dryRun: false, confirmToken: dry.body.confirmToken }).then((res) => {
        expect(res.status, JSON.stringify(res.body)).to.eq(200);
        return res.body;
      });
    });
  }

  function expectImportRefused(cellShape: string, actor: SecurityActor, csv: string) {
    cy.task('security:checkCell', { cell: cell('sx_entry', 'import', 'fk_to_unreachable', cellShape), status: 404 });
    readAll([{ model: 'sx_entry' }]).then((before) => {
      const snapshotBefore = JSON.stringify(before);
      importCsv(actor, csv).then((body) => {
        expect(body.summary.succeeded, JSON.stringify(body)).to.eq(0);
        expect(body.errors.map((e) => e.code), JSON.stringify(body)).to.include('NOT_FOUND');
      });
      readAll([{ model: 'sx_entry' }]).then((after) => expect(JSON.stringify(after)).to.eq(snapshotBefore));
    });
  }

  // security-cell: entity=sx_entry operation=import case=fk_to_unreachable fk_shape=many_to_one_required
  // security-cell: entity=sx_entry operation=import case=fk_to_unreachable fk_shape=many_to_one_optional
  it('import naming a required account of another organization reports NOT_FOUND and writes nothing', () => {
    newAccount(orgA).then((mine) => {
      newAccount(orgB).then((foreign) => {
        expectImportRefused('many_to_one_required', writer, csvOf(foreign.name as string, mine.name as string));
      });
    });
  });

  it('import naming an optional account of another organization reports NOT_FOUND and writes nothing', () => {
    newAccount(orgA).then((mine) => {
      newAccount(orgB).then((foreign) => {
        expectImportRefused('many_to_one_optional', writer, csvOf(mine.name as string, foreign.name as string));
      });
    });
  });

  it('import of rows whose references are reachable succeeds', () => {
    newAccount(orgA).then((a) => {
      newAccount(orgA).then((b) => {
        importCsv(writer, csvOf(a.name as string, b.name as string)).then((body) => {
          expect(body.summary.succeeded, JSON.stringify(body)).to.eq(1);
        });
      });
    });
  });

  // security-cell: entity=sx_entry operation=import case=cross_org
  it('import naming another organization, or the key of a row of another organization, writes nothing there', () => {
    cy.task('security:checkCell', { cell: { entity: 'sx_entry', operation: 'import', case: 'cross_org' }, status: 404 });
    cy.task<Row[]>('security:snapshot', { model: 'organization', where: { id: orgB } }).then(([foreignOrg]) => {
      newAccount(orgA).then((mine) => {
        // The organization column resolves within the caller's organizations only.
        const foreignOrgCsv = `code,organization_name,sx_account_name\n${uniq('csv')},${foreignOrg.name as string},${mine.name as string}\n`;
        readAll([{ model: 'sx_entry' }]).then((before) => {
          const snapshotBefore = JSON.stringify(before);
          importCsv(writer, foreignOrgCsv).then((body) => {
            expect(body.summary.succeeded, JSON.stringify(body)).to.eq(0);
            expect(body.errors.map((e) => e.code), JSON.stringify(body)).to.include('NOT_FOUND');
          });
          readAll([{ model: 'sx_entry' }]).then((after) => expect(JSON.stringify(after)).to.eq(snapshotBefore));
        });
        // A row of another organization with the same key is not matched, so it is never updated.
        newAccount(orgB).then((foreignAccount) => {
          const code = uniq('shared');
          seedRow<Row>('sx_entry', { code, organization_id: orgB, sx_account_id: foreignAccount.id, ...audit() }).then((foreignEntry) => {
            readAll([{ model: 'sx_entry', where: { id: foreignEntry.id } }]).then((before) => {
              const snapshotBefore = JSON.stringify(before);
              importCsv(writer, csvOf(mine.name as string, '', code));
              readAll([{ model: 'sx_entry', where: { id: foreignEntry.id } }]).then((after) => expect(JSON.stringify(after)).to.eq(snapshotBefore));
            });
          });
        });
      });
    });
  });

  describe('outside the caller\'s Assignee read scope (same organization)', () => {
    let scoped: SecurityActor & { userId: string };
    before(() => {
      cy.then(() =>
        seedScopedActor('import_scope', [orgA], [
          { entity: 'sx_entry', scope: 'general', flags: { create: true, read: true, update: true, import: true } },
          { entity: 'organization', scope: 'general', flags: { read: true } },
          { entity: 'sx_account', scope: 'Assignee', flags: { read: true } },
        ]).then((a) => {
          scoped = a;
        }),
      );
    });

    it('import naming a required account the caller cannot read reports NOT_FOUND at the commit and writes nothing', () => {
      newAccount(orgA).then((theirs) => {
        newAccount(orgA, { assignee_id: scoped.userId }).then((mine) => {
          expectImportRefused('many_to_one_required', scoped, csvOf(theirs.name as string, mine.name as string));
        });
      });
    });

    it('import naming an optional account the caller cannot read reports NOT_FOUND at the commit and writes nothing', () => {
      newAccount(orgA).then((theirs) => {
        newAccount(orgA, { assignee_id: scoped.userId }).then((mine) => {
          expectImportRefused('many_to_one_optional', scoped, csvOf(mine.name as string, theirs.name as string));
        });
      });
    });

    it('import naming only accounts assigned to the caller succeeds', () => {
      newAccount(orgA, { assignee_id: scoped.userId }).then((a) => {
        importCsv(scoped, csvOf(a.name as string, '')).then((body) => {
          expect(body.summary.succeeded, JSON.stringify(body)).to.eq(1);
        });
      });
    });
  });
});
