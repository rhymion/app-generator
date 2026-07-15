import { TEST_CREDENTIALS, TEST_API_KEY } from '../../support/test-credentials';

const ROLE_API_BASE = '/api/role';
const ROLE_IMPORT_PATH = `${ROLE_API_BASE}/import`;
const PERMISSION_API_BASE = '/api/permission';
const PERMISSION_IMPORT_PATH = `${PERMISSION_API_BASE}/import`;

describe('API: CSV Import batch2 (cmd_328) — dotted FK + Tier2/Tier3 authorization', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    Cypress.session.clearAllSavedSessions();
  });

  // test4 (redesigned per gunshi subtask_328d): the original "other org row" scenario
  // is N/A for this schema (all 5 importable entities have should_filter_by_org=False).
  // Replaced with: an actor whose permission for 'role' has import:false is rejected
  // at Tier2 (assertPermission), before any row is even parsed for match/create/update.
  //
  // F2 (cmd_328 batch3): assertPermission() throws a plain `Error` (not `ApiError`),
  // which handleApiError() would otherwise map to 500. The import/export route
  // templates now wrap the assertPermission call in a template-level try-catch that
  // returns 403 directly, so Tier2 rejections correctly surface as 403 Forbidden.
  it('test4: an actor with import:false on role is rejected at Tier2 (assertPermission)', () => {
    cy.task<string>('db:createSessionUserWithPermission', {
      entityName: 'role',
      flags: { create: true, read: true, update: true, delete: true, import: false },
      label: 't4',
    }).then((email) => {
      cy.login(email, TEST_CREDENTIALS.password);
      cy.request({
        method: 'POST',
        url: ROLE_IMPORT_PATH,
        body: { csv: 'name\nTier2RejectRole', dryRun: true },
        failOnStatusCode: false,
      }).then((res) => {
        expect(res.status).to.eq(403);
        expect(res.body.error).to.eq('Forbidden');
      });
    });
  });

  // test5: Tier3 rejection when updating a row the actor cannot update.
  //
  // NOTE ON DESIGN DEVIATION (Creator-role isolation): subtask_328d's design proposed
  // a Creator-role actor who owns some rows but not others, updating a row created by
  // someone else. Investigation found `permissions.import` is derived ONLY from
  // general (non-Creator/Assignee) permission rows (lib/authz.ts ~line 246:
  // `import: general.import`). A Creator-only role can therefore never pass Tier2's
  // assertPermission('import', ...) — it cannot reach this code path at all.
  // Reproducing the intended scenario would require layering a second, general-scoped
  // permission row (import:true only) on top of a Creator role — new db-helpers
  // plumbing outside this task's declared file-change scope (build_context.py +
  // api_import_route.ts.jinja2). Using the design's own documented fallback:
  // "一般 update 権限のない actor → 全 row 拒否".
  it('test5: an actor without general update permission is rejected at Tier3 when updating an existing row', () => {
    cy.request({
      method: 'POST',
      url: ROLE_API_BASE,
      headers: { 'X-API-Key': TEST_API_KEY },
      body: { name: 'OwnedByAdmin', users_ids: [] },
    }).then(() => {
      cy.task<string>('db:createSessionUserWithPermission', {
        entityName: 'role',
        flags: { create: false, read: true, update: false, delete: false, import: true },
        label: 't5',
      }).then((email) => {
        cy.login(email, TEST_CREDENTIALS.password);
        cy.request({
          method: 'POST',
          url: ROLE_IMPORT_PATH,
          body: { csv: 'name\nOwnedByAdmin', dryRun: true },
        }).then((res) => {
          expect(res.status).to.eq(200);
          expect(res.body.errors).to.have.length(1);
          expect(res.body.errors[0].code).to.eq('ACCESS_DENIED');
        });
      });
    });
  });

  describe('test6: Tier3 create/update permission split', () => {
    // test6a: import:true, create:true, update:false → CSV matches an existing row
    // (UPDATE path) → Tier3 rejects on the update flag.
    it('6a: create:true/update:false actor is rejected when the CSV row matches an existing record', () => {
      cy.request({
        method: 'POST',
        url: ROLE_API_BASE,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: { name: 'ExistingRole6a', users_ids: [] },
      }).then(() => {
        cy.task<string>('db:createSessionUserWithPermission', {
          entityName: 'role',
          flags: { create: true, read: true, update: false, delete: false, import: true },
          label: 't6a',
        }).then((email) => {
          cy.login(email, TEST_CREDENTIALS.password);
          cy.request({
            method: 'POST',
            url: ROLE_IMPORT_PATH,
            body: { csv: 'name\nExistingRole6a', dryRun: true },
          }).then((res) => {
            expect(res.status).to.eq(200);
            expect(res.body.errors).to.have.length(1);
            expect(res.body.errors[0].code).to.eq('ACCESS_DENIED');
          });
        });
      });
    });

    // test6b: import:true, create:false, update:true → CSV names a nonexistent role
    // (CREATE path). Tier1 (import_can_create, from x-generate.new) passes for role,
    // but Tier3 permissions.create=false rejects it.
    it('6b: create:false/update:true actor is rejected when the CSV row has no match (CREATE path)', () => {
      cy.task<string>('db:createSessionUserWithPermission', {
        entityName: 'role',
        flags: { create: false, read: true, update: true, delete: false, import: true },
        label: 't6b',
      }).then((email) => {
        cy.login(email, TEST_CREDENTIALS.password);
        cy.request({
          method: 'POST',
          url: ROLE_IMPORT_PATH,
          body: { csv: 'name\n__nonexistent_role_6b__', dryRun: true },
        }).then((res) => {
          expect(res.status).to.eq(200);
          expect(res.body.errors).to.have.length(1);
          expect(res.body.errors[0].code).to.eq('ACCESS_DENIED');
        });
      });
    });
  });

  describe('permission entity: dotted FK import (role.name → role_id)', () => {
    it('p1: basic UPDATE resolves role.name to role_id and applies non-key column changes', () => {
      cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
      cy.request({
        method: 'POST',
        url: ROLE_API_BASE,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: { name: 'Editor', users_ids: [] },
      }).then((roleRes) => {
        const roleId = roleRes.body.id;
        cy.request({
          method: 'POST',
          url: PERMISSION_API_BASE,
          headers: { 'X-API-Key': TEST_API_KEY },
          body: { name: 'Edit Documents', create: false, read: true, update: false, delete: false, role_id: roleId },
        }).then((permRes) => {
          const permId = permRes.body.id;
          const csv = 'name,role_name,create,read,update,delete\nEdit Documents,Editor,false,true,true,false';
          cy.request({ method: 'POST', url: PERMISSION_IMPORT_PATH, body: { csv, dryRun: true } }).then((dryRes) => {
            expect(dryRes.body.errors).to.have.length(0);
            const token = dryRes.body.confirmToken;
            cy.request({
              method: 'POST',
              url: PERMISSION_IMPORT_PATH,
              body: { csv, dryRun: false, confirmToken: token },
            }).then((commitRes) => {
              expect(commitRes.body.summary.succeeded).to.eq(1);
              expect(commitRes.body.errors).to.have.length(0);
            });
          });
          cy.request({ url: `${PERMISSION_API_BASE}/${permId}`, headers: { 'X-API-Key': TEST_API_KEY } }).then((res) => {
            expect(res.body.update).to.eq(true);
            expect(res.body.role_id).to.eq(roleId);
          });
        });
      });
    });

    it('p2: a role_name with no matching role is rejected with NOT_FOUND', () => {
      cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
      const csv = 'name,role_name,create,read,update,delete\nEdit Documents,__no_such_role__,false,true,true,false';
      cy.request({ method: 'POST', url: PERMISSION_IMPORT_PATH, body: { csv, dryRun: true } }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body.errors).to.have.length(1);
        expect(res.body.errors[0].code).to.eq('NOT_FOUND');
      });
    });

    it('p3: an empty role_name resolves to role_id=null and creates the row', () => {
      cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
      const csv = 'name,role_name,create,read,update,delete\nGlobal Read,,false,true,false,false';
      cy.request({ method: 'POST', url: PERMISSION_IMPORT_PATH, body: { csv, dryRun: true } }).then((dryRes) => {
        expect(dryRes.body.errors).to.have.length(0);
        const token = dryRes.body.confirmToken;
        cy.request({
          method: 'POST',
          url: PERMISSION_IMPORT_PATH,
          body: { csv, dryRun: false, confirmToken: token },
        }).then((commitRes) => {
          expect(commitRes.body.summary.succeeded).to.eq(1);
        });
      });
      cy.request({ url: PERMISSION_API_BASE, headers: { 'X-API-Key': TEST_API_KEY } }).then((res) => {
        const row = (res.body.rows as Array<{ name: string; role_id: string | null }>).find((r) => r.name === 'Global Read');
        expect(row).to.exist;
        expect(row!.role_id).to.eq(null);
      });
    });

    // p4 (F1, cmd_328 batch3): DEV-1 fix e2e proof — a CREATE row with a non-null
    // role_name resolves via the dotted-FK lookup and the resulting role_id is
    // actually persisted (keyWhere is spread into the create data).
    it('p4: permission CREATE with non-null role_name writes role_id to the DB', () => {
      cy.request({
        method: 'POST',
        url: ROLE_API_BASE,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: { name: '__test_role_p4__', users_ids: [] },
      }).then((roleRes) => {
        const roleId = roleRes.body.id;
        cy.task<string>('db:createSessionUserWithPermission', {
          entityName: 'permission',
          flags: { create: true, read: true, update: true, delete: false, import: true },
          label: 'p4',
        }).then((email) => {
          cy.login(email, TEST_CREDENTIALS.password);
          const csv = 'name,role_name,create,read,update,delete\n__perm_p4_test__,__test_role_p4__,true,true,false,false';
          cy.request({ method: 'POST', url: PERMISSION_IMPORT_PATH, body: { csv, dryRun: true } }).then((dryRes) => {
            expect(dryRes.body.errors).to.have.length(0);
            const token = dryRes.body.confirmToken;
            cy.request({
              method: 'POST',
              url: PERMISSION_IMPORT_PATH,
              body: { csv, dryRun: false, confirmToken: token },
            }).then((commitRes) => {
              expect(commitRes.body.summary.succeeded).to.eq(1);
              expect(commitRes.body.errors).to.have.length(0);
            });
          });
          cy.request({ url: PERMISSION_API_BASE, headers: { 'X-API-Key': TEST_API_KEY } }).then((res) => {
            const row = (res.body.rows as Array<{ name: string; role_id: string | null }>).find(
              (r) => r.name === '__perm_p4_test__',
            );
            expect(row).to.exist;
            expect(row!.role_id).to.eq(roleId);
          });
        });
      });
    });
  });
});
