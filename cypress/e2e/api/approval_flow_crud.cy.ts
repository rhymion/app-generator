// Hand-written (not generator-produced) — cmd_665.
//
// Recovered from the generator-produced cypress/e2e/api/approval_flow.cy.ts
// as it existed immediately before x-generate.test was set to false for
// approval_flow (app-generator commit 4e8ae006, the last commit where this
// file was still generated). See ../approval_flow_desktop_crud.cy.ts for
// the full rationale. All 33 tests here are usable unmodified: every one
// that touches preceded_by/followed_by at all sends empty arrays (verified
// by reading the original generated file before this port — it never
// exercised a real link, cross-entity_name or otherwise), so nothing needed
// a same-entity_name adjustment — only the seeding mechanism changed, from
// generated Cypress tasks to direct API calls
// (../../support/approval_flow_seed.ts). db:createApiUserWithPermission and
// db:createLimitedApiUser are generic (not approval_flow-specific) tasks
// untouched by x-generate.test, so those two are kept as-is.
import { TEST_API_KEY, TEST_CREDENTIALS } from '../../support/test-credentials';
import {
  apiPopulateApprovalFlowDependencies,
  seedApprovalFlowRows,
} from '../../support/approval_flow_seed';

const API_BASE = '/api/approval_flow';

// FK Permission / Cross-org Test Coverage (cmd_520 batch A): 7.3(PUT denied)=yes, 7.4(DELETE denied)=yes, 7.5(export denied)=yes, 7.6(import denied)=yes, G3(cross-org isolation)=no(should_filter_by_org=false)

describe('API: Approval Flow (hand-written port, cmd_665)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    Cypress.session.clearAllSavedSessions();
  });

  describe('GET /api/approval_flow', () => {
    it('1.1 returns empty page when no items', () => {
      cy.request({ url: API_BASE, headers: { 'X-API-Key': TEST_API_KEY } })
        .then((res) => {
          expect(res.status).to.eq(200);
          expect(res.body.rows).to.deep.eq([]);
          expect(res.body.total).to.eq(0);
          expect(res.body.page).to.eq(0);
          expect(res.body.pageSize).to.be.a('number');
        });
    });

    it('1.2 returns page with items', () => {
      seedApprovalFlowRows(1);
      cy.request({ url: API_BASE, headers: { 'X-API-Key': TEST_API_KEY } })
        .then((res) => {
          expect(res.status).to.eq(200);
          expect(res.body.rows).to.have.length(1);
          expect(res.body.total).to.eq(1);
        });
    });
  });

  describe('GET /api/approval_flow/:id', () => {
    it('2.1 returns item detail by id', () => {
      seedApprovalFlowRows(1).then((records) => {
        cy.request({ url: `${API_BASE}/${records[0].id}`, headers: { 'X-API-Key': TEST_API_KEY } })
          .then((res) => {
            expect(res.status).to.eq(200);
            expect(res.body.id).to.eq(records[0].id);
          });
      });
    });

    it('2.2 returns 404 for non-existent id', () => {
      cy.request({ url: `${API_BASE}/non-existent-id`, headers: { 'X-API-Key': TEST_API_KEY }, failOnStatusCode: false })
        .then((res) => {
          expect(res.status).to.eq(404);
        });
    });
  });

  describe('POST /api/approval_flow', () => {
    it('3.1 creates with required fields, verified by GET', () => {
      apiPopulateApprovalFlowDependencies().then((deps) => {
        cy.request({
          method: 'POST',
          url: API_BASE,
          headers: { 'X-API-Key': TEST_API_KEY },
          body: {
            entity_name: 'user',
            approver_role_id: deps.role.id,
            precededBy_ids: [],
            followedBy_ids: [],
          },
        }).then((res) => {
          expect(res.status).to.eq(201);
          cy.request({ url: `${API_BASE}/${res.body.id}`, headers: { 'X-API-Key': TEST_API_KEY } })
            .then((getRes) => {
              expect(getRes.status).to.eq(200);
              expect(getRes.body.entity_name).to.eq('user');
            });
        });
      });
    });

    it('5.1 fails when a required field is missing', () => {
      apiPopulateApprovalFlowDependencies().then((deps) => {
        cy.request({
          method: 'POST',
          url: API_BASE,
          headers: { 'X-API-Key': TEST_API_KEY },
          body: {
            approver_role_id: deps.role.id,
            precededBy_ids: [],
            followedBy_ids: [],
          },
          failOnStatusCode: false,
        }).then((res) => {
          expect(res.status).to.be.gte(400);
        });
      });
    });
  });

  describe('PUT /api/approval_flow/:id', () => {
    it('4.1 updates, verified by GET', () => {
      seedApprovalFlowRows(1).then((records) => {
        cy.request({
          method: 'PUT',
          url: `${API_BASE}/${records[0].id}`,
          headers: { 'X-API-Key': TEST_API_KEY },
          body: {
            entity_name: 'setting',
            requestor_role_id: records[0].requestor_role_id,
            approver_role_id: records[0].approver_role_id,
            precededBy_ids: [],
            followedBy_ids: [],
          },
        }).then((res) => {
          expect(res.status).to.eq(200);
          cy.request({ url: `${API_BASE}/${records[0].id}`, headers: { 'X-API-Key': TEST_API_KEY } })
            .then((getRes) => {
              expect(getRes.status).to.eq(200);
              expect(getRes.body.entity_name).to.eq('setting');
            });
        });
      });
    });
  });

  describe('DELETE /api/approval_flow/:id', () => {
    it('4.2 deletes item, verified by GET returning 4xx', () => {
      seedApprovalFlowRows(1).then((records) => {
        cy.request({
          method: 'DELETE',
          url: `${API_BASE}/${records[0].id}`,
          headers: { 'X-API-Key': TEST_API_KEY },
        }).then((res) => {
          expect(res.status).to.eq(204);
          cy.request({ url: `${API_BASE}/${records[0].id}`, headers: { 'X-API-Key': TEST_API_KEY }, failOnStatusCode: false })
            .then((getRes) => {
              expect(getRes.status).to.be.gte(400);
            });
        });
      });
    });
  });

  // -------------------------------------------------------------------------
  // Bulk operations
  // -------------------------------------------------------------------------

  describe('POST /api/approval_flow/bulk', () => {
    it('8.1 bulk creates — all succeed, summary reflects counts', () => {
      apiPopulateApprovalFlowDependencies().then((deps) => {
        cy.request({
          method: 'POST',
          url: `${API_BASE}/bulk`,
          headers: { 'X-API-Key': TEST_API_KEY },
          body: [
            {
              entity_name: 'user',
              approver_role_id: deps.role.id,
              precededBy_ids: [],
              followedBy_ids: [],
            },
          ],
        }).then((res) => {
          expect(res.status).to.eq(207);
          expect(res.body.summary.total).to.eq(1);
          expect(res.body.summary.succeeded).to.eq(1);
          expect(res.body.summary.failed).to.eq(0);
          expect(res.body.results[0].success).to.be.true;
          expect(res.body.results[0].data.id).to.exist;
        });
      });
    });

    it('8.2 bulk creates — partial failure when a required field is missing', () => {
      apiPopulateApprovalFlowDependencies().then((deps) => {
        cy.request({
          method: 'POST',
          url: `${API_BASE}/bulk`,
          headers: { 'X-API-Key': TEST_API_KEY },
          body: [
            {
              entity_name: 'user',
              approver_role_id: deps.role.id,
              precededBy_ids: [],
              followedBy_ids: [],
            },
            {
              approver_role_id: deps.role.id,
              precededBy_ids: [],
              followedBy_ids: [],
            },
          ],
        }).then((res) => {
          expect(res.status).to.eq(207);
          expect(res.body.summary.total).to.eq(2);
          expect(res.body.summary.succeeded).to.eq(1);
          expect(res.body.summary.failed).to.eq(1);
          expect(res.body.results[0].success).to.be.true;
          expect(res.body.results[1].success).to.be.false;
          expect(res.body.results[1].error).to.be.a('string');
        });
      });
    });
  });

  describe('PUT /api/approval_flow/bulk', () => {
    it('9.1 bulk updates — all succeed, summary reflects counts', () => {
      seedApprovalFlowRows(1).then((records) => {
        cy.request({
          method: 'PUT',
          url: `${API_BASE}/bulk`,
          headers: { 'X-API-Key': TEST_API_KEY },
          body: [
            {
              id: records[0].id,
              entity_name: 'setting',
              requestor_role_id: records[0].requestor_role_id,
              approver_role_id: records[0].approver_role_id,
              precededBy_ids: [],
              followedBy_ids: [],
            },
          ],
        }).then((res) => {
          expect(res.status).to.eq(207);
          expect(res.body.summary.total).to.eq(1);
          expect(res.body.summary.succeeded).to.eq(1);
          expect(res.body.summary.failed).to.eq(0);
          expect(res.body.results[0].success).to.be.true;
        });
      });
    });

    it('9.2 bulk updates — partial failure for non-existent id', () => {
      seedApprovalFlowRows(1).then((records) => {
        cy.request({
          method: 'PUT',
          url: `${API_BASE}/bulk`,
          headers: { 'X-API-Key': TEST_API_KEY },
          body: [
            {
              id: records[0].id,
              entity_name: 'setting',
              requestor_role_id: records[0].requestor_role_id,
              approver_role_id: records[0].approver_role_id,
              precededBy_ids: [],
              followedBy_ids: [],
            },
            { id: 'non-existent-id' },
          ],
        }).then((res) => {
          expect(res.status).to.eq(207);
          expect(res.body.summary.total).to.eq(2);
          expect(res.body.summary.succeeded).to.eq(1);
          expect(res.body.summary.failed).to.eq(1);
          expect(res.body.results[1].success).to.be.false;
        });
      });
    });
  });

  describe('DELETE /api/approval_flow/bulk', () => {
    it('10.1 bulk deletes — all succeed, items are gone', () => {
      seedApprovalFlowRows(1).then((records) => {
        cy.request({
          method: 'DELETE',
          url: `${API_BASE}/bulk`,
          headers: { 'X-API-Key': TEST_API_KEY },
          body: [{ id: records[0].id }],
        }).then((res) => {
          expect(res.status).to.eq(207);
          expect(res.body.summary.succeeded).to.eq(1);
          expect(res.body.summary.failed).to.eq(0);
          cy.request({
            url: `${API_BASE}/${records[0].id}`,
            headers: { 'X-API-Key': TEST_API_KEY },
            failOnStatusCode: false,
          }).then((getRes) => {
            expect(getRes.status).to.be.gte(400);
          });
        });
      });
    });

    it('10.2 bulk deletes — partial failure for non-existent id', () => {
      seedApprovalFlowRows(1).then((records) => {
        cy.request({
          method: 'DELETE',
          url: `${API_BASE}/bulk`,
          headers: { 'X-API-Key': TEST_API_KEY },
          body: [{ id: records[0].id }, { id: 'non-existent-id' }],
        }).then((res) => {
          expect(res.status).to.eq(207);
          expect(res.body.summary.total).to.eq(2);
          expect(res.body.summary.succeeded).to.eq(1);
          expect(res.body.summary.failed).to.eq(1);
          expect(res.body.results[0].success).to.be.true;
          expect(res.body.results[1].success).to.be.false;
        });
      });
    });
  });

  // cmd_516 Option B: searchRoleOptions()/getAvailable...() now degrade
  // gracefully (empty + permissionDenied flag) instead of throwing when the
  // caller lacks read on role — see
  // docs/knowledge/fk-read-permission-graceful-degradation.md. This
  // regression-tests the most dangerous failure mode: a PUT that omits the
  // FK field entirely (exactly what the UI now sends when that field
  // renders disabled) must leave the existing approver_role_id value
  // untouched, never null it out.
  describe('FK read-permission graceful degradation (PUT /api/approval_flow/:id)', () => {
    it('4.4 preserves approver_role_id when the acting user cannot read role and omits it from the PUT body', () => {
      seedApprovalFlowRows(1).then((records) => {
        const original = records[0];
        // Full CRUD on approval_flow itself, but no permission row at all on
        // role — defaults to deny (getModelPermissions: "no rows = deny
        // all"), reproducing the exact actor the UI's AppFieldRelation
        // permissionDenied branch is for.
        cy.task<string>('db:createApiUserWithPermission', {
          entityName: 'approval_flow',
          flags: { create: true, read: true, update: true, delete: true },
          label: 'fk_read_denied',
        }).then((restrictedKey) => {
          cy.request({
            method: 'PUT',
            url: `${API_BASE}/${original.id}`,
            headers: { 'X-API-Key': restrictedKey },
            body: {
              entity_name: original.entity_name,
              requestor_role_id: original.requestor_role_id,
              precededBy_ids: [],
              followedBy_ids: [],
            },
          }).then((res) => {
            expect(res.status).to.eq(200);
            cy.request({ url: `${API_BASE}/${original.id}`, headers: { 'X-API-Key': restrictedKey } })
              .then((getRes) => {
                expect(getRes.status).to.eq(200);
                expect(
                  getRes.body.approver_role?.id,
                  'approver_role_id must not be nulled out by a PUT that omits it',
                ).to.eq(original.approver_role_id);
              });
          });
        });
      });
    });

    // cmd_648: pure-API counterpart of the UI regression spec
    // (fk_read_permission_graceful_degradation.cy.ts, under cypress/e2e/ —
    // drives the browser rather than the API) — proves via X-API-Key alone
    // that GET (list and detail) never crashes for an actor who can read
    // approval_flow but not role; it simply returns 200 with whatever the FK
    // relation resolves to.
    it('4.5 returns 200 for GET (list and detail) when the acting user cannot read role', () => {
      seedApprovalFlowRows(1).then((records) => {
        const original = records[0];
        cy.task<string>('db:createApiUserWithPermission', {
          entityName: 'approval_flow',
          flags: { create: true, read: true, update: true, delete: true },
          label: 'fk_read_denied_get',
        }).then((restrictedKey) => {
          cy.request({ url: API_BASE, headers: { 'X-API-Key': restrictedKey } })
            .then((listRes) => {
              expect(listRes.status).to.eq(200);
            });
          cy.request({ url: `${API_BASE}/${original.id}`, headers: { 'X-API-Key': restrictedKey } })
            .then((getRes) => {
              expect(getRes.status).to.eq(200);
            });
        });
      });
    });
  });

  describe('Authentication errors', () => {
    it('6.1 returns 4xx without API key', () => {
      cy.request({ url: API_BASE, failOnStatusCode: false })
        .then((res) => {
          expect(res.status).to.be.gte(400);
        });
    });

    it('6.2 returns 4xx with invalid API key', () => {
      cy.request({ url: API_BASE, headers: { 'X-API-Key': 'invalid_key' }, failOnStatusCode: false })
        .then((res) => {
          expect(res.status).to.be.gte(400);
        });
    });
  });

  describe('Permission errors', () => {
    it('7.1 returns 4xx for GET list when permission denied', () => {
      cy.task<string>('db:createLimitedApiUser', 'approval_flow').then((limitedKey) => {
        cy.request({ url: API_BASE, headers: { 'X-API-Key': limitedKey }, failOnStatusCode: false })
          .then((res) => {
            expect(res.status).to.be.gte(400);
          });
      });
    });

    it('7.2 returns 4xx for POST when permission denied', () => {
      apiPopulateApprovalFlowDependencies().then((deps) => {
        cy.task<string>('db:createLimitedApiUser', 'approval_flow').then((limitedKey) => {
          cy.request({
            method: 'POST',
            url: API_BASE,
            headers: { 'X-API-Key': limitedKey },
            body: {
              entity_name: 'user',
              approver_role_id: deps.role.id,
              precededBy_ids: [],
              followedBy_ids: [],
            },
            failOnStatusCode: false,
          }).then((res) => {
            expect(res.status).to.be.gte(400);
          });
        });
      });
    });

    it('7.3 returns 4xx for PUT when permission denied', () => {
      seedApprovalFlowRows(1).then((records) => {
        cy.task<string>('db:createLimitedApiUser', 'approval_flow').then((limitedKey) => {
          cy.request({
            method: 'PUT',
            url: `${API_BASE}/${records[0].id}`,
            headers: { 'X-API-Key': limitedKey },
            body: {},
            failOnStatusCode: false,
          }).then((res) => {
            expect(res.status).to.be.gte(400);
          });
        });
      });
    });

    it('7.4 returns 4xx for DELETE when permission denied', () => {
      seedApprovalFlowRows(1).then((records) => {
        cy.task<string>('db:createLimitedApiUser', 'approval_flow').then((limitedKey) => {
          cy.request({
            method: 'DELETE',
            url: `${API_BASE}/${records[0].id}`,
            headers: { 'X-API-Key': limitedKey },
            failOnStatusCode: false,
          }).then((res) => {
            expect(res.status).to.be.gte(400);
          });
        });
      });
    });

    // cmd_658: export now resolves the actor via resolveActorId() (cmd_648
    // dual-auth), which reads X-API-Key the same as every other route below
    // — this used to require a SESSION-loginable actor (cy.login) because
    // the route read getSessionUserId() exclusively; that exclusivity is
    // gone.
    it('7.5 returns 4xx for GET export when permission denied', () => {
      cy.task<string>('db:createLimitedApiUser', 'approval_flow').then((limitedKey) => {
        cy.request({
          url: `${API_BASE}/export`,
          headers: { 'X-API-Key': limitedKey },
          failOnStatusCode: false,
        }).then((res) => {
          expect(res.status).to.be.gte(400);
        });
      });
    });

    // cmd_658: see the 7.5 comment above — import resolves the actor the
    // same dual-auth way (cmd_648) and no longer needs a session-loginable
    // actor.
    it('7.6 returns 4xx for POST import when permission denied', () => {
      cy.task<string>('db:createLimitedApiUser', 'approval_flow').then((limitedKey) => {
        cy.request({
          method: 'POST',
          url: `${API_BASE}/import`,
          headers: { 'X-API-Key': limitedKey },
          body: { csv: '', dryRun: true },
          failOnStatusCode: false,
        }).then((res) => {
          expect(res.status).to.be.gte(400);
        });
      });
    });
  });

  describe('GET /api/approval_flow/export', () => {
    it('N1 returns 200 CSV with attachment disposition', () => {
      cy.request({ url: `/api/approval_flow/export`, headers: { 'X-API-Key': TEST_API_KEY } })
        .then((res) => {
          expect(res.status).to.eq(200);
          expect(res.headers['content-type']).to.include('text/csv');
          expect(res.headers['content-disposition']).to.include('attachment');
        });
    });

    it('N2 CSV header row does not include an id column', () => {
      seedApprovalFlowRows(1);
      cy.request({ url: `/api/approval_flow/export`, headers: { 'X-API-Key': TEST_API_KEY } })
        .then((res) => {
          const headerLine = (res.body as string).replace(/^﻿/, '').split('\r\n')[0];
          const headers = headerLine.split(',');
          expect(headers).to.not.include('id');
        });
    });

    it('N4 CSV header includes the x-import-key natural-key column(s) present in the export allowlist', () => {
      seedApprovalFlowRows(1);
      cy.request({ url: `/api/approval_flow/export`, headers: { 'X-API-Key': TEST_API_KEY } })
        .then((res) => {
          const headerLine = (res.body as string).replace(/^﻿/, '').split('\r\n')[0];
          const headers = headerLine.split(',');
          expect(headers).to.include('entity_name');
        });
    });

    it('N5 CSV header does not include system fields (timestamps/audit/tenant refs)', () => {
      seedApprovalFlowRows(1);
      cy.request({ url: `/api/approval_flow/export`, headers: { 'X-API-Key': TEST_API_KEY } })
        .then((res) => {
          const headerLine = (res.body as string).replace(/^﻿/, '').split('\r\n')[0];
          const headers = headerLine.split(',');
          expect(headers).to.not.include('id');
          expect(headers).to.not.include('created_at');
          expect(headers).to.not.include('updated_at');
          expect(headers).to.not.include('creator_id');
          expect(headers).to.not.include('updater_id');
          expect(headers).to.not.include('organization_id');
        });
    });

    it('N6 CSV export headers match the view-field allowlist exactly', () => {
      seedApprovalFlowRows(1);
      cy.request({ url: `/api/approval_flow/export`, headers: { 'X-API-Key': TEST_API_KEY } })
        .then((res) => {
          const headerLine = (res.body as string).replace(/^﻿/, '').split('\r\n')[0];
          const headers = headerLine.split(',');
          expect(headers).to.include('entity_name');
          expect(headers).to.include('requestor_role_name');
          expect(headers).to.include('approver_role_name');
          expect(headers).to.not.include('id');
          expect(headers).to.not.include('creator_id');
          expect(headers).to.not.include('updater_id');
          expect(headers).to.not.include('organization_id');
          expect(headers).to.not.include('tenant_id');
        });
    });

    it('N11 CSV import round-trip: re-importing an exported row matches it via the natural key with zero errors (dry run)', () => {
      seedApprovalFlowRows(1).then(() => {
        cy.request({ url: `/api/approval_flow/export`, headers: { 'X-API-Key': TEST_API_KEY } }).then((exportRes) => {
          expect(exportRes.status).to.eq(200);
          const csv = exportRes.body as string;
          cy.request({
            method: 'POST',
            url: `/api/approval_flow/import`,
            headers: { 'X-API-Key': TEST_API_KEY },
            body: { csv, dryRun: true },
          }).then((res) => {
            expect(res.status).to.eq(200);
            expect(res.body.errors).to.have.length(0);
            expect(res.body.summary.failed).to.eq(0);
            expect(res.body.summary.total).to.be.greaterThan(0);
            expect(res.body.summary.succeeded).to.eq(res.body.summary.total);
            expect(res.body.confirmToken).to.be.a('string');
          });
        });
      });
    });

    it('N12 CSV import round-trip: confirming the dry run (dryRun=false) commits with zero write failures', () => {
      seedApprovalFlowRows(1).then(() => {
        cy.request({ url: `/api/approval_flow/export`, headers: { 'X-API-Key': TEST_API_KEY } }).then((exportRes) => {
          const csv = exportRes.body as string;
          cy.request({
            method: 'POST',
            url: `/api/approval_flow/import`,
            headers: { 'X-API-Key': TEST_API_KEY },
            body: { csv, dryRun: true },
          }).then((dryRunRes) => {
            const confirmToken = dryRunRes.body.confirmToken as string;
            cy.request({
              method: 'POST',
              url: `/api/approval_flow/import`,
              headers: { 'X-API-Key': TEST_API_KEY },
              body: { csv, dryRun: false, confirmToken },
            }).then((commitRes) => {
              expect(commitRes.status).to.eq(200);
              expect(commitRes.body.errors).to.have.length(0);
              expect(commitRes.body.summary.failed).to.eq(0);
              expect(commitRes.body.summary.succeeded).to.be.greaterThan(0);
            });
          });
        });
      });
    });

    it('N13 CSV import rejects an unconfirmed commit (dryRun=false without a valid confirmToken)', () => {
      seedApprovalFlowRows(1).then(() => {
        cy.request({ url: `/api/approval_flow/export`, headers: { 'X-API-Key': TEST_API_KEY } }).then((exportRes) => {
          const csv = exportRes.body as string;
          cy.request({
            method: 'POST',
            url: `/api/approval_flow/import`,
            headers: { 'X-API-Key': TEST_API_KEY },
            body: { csv, dryRun: false },
            failOnStatusCode: false,
          }).then((res) => {
            expect(res.status).to.eq(400);
            expect(res.body.errors[0].code).to.eq('INVALID_CONFIRM_TOKEN');
          });
        });
      });
    });

    // cmd_658: N1-N13 above prove the X-API-Key path (cmd_648 dual-auth).
    // This is the one deliberate session-cookie test for this route family
    // — resolveActorId()/requireDualAuth() (lib/api-auth.ts) is shared by
    // every dual-auth route, so proving the session branch here once is
    // sufficient; it is not re-proven per route. Do not delete this without
    // also removing the last session-cookie coverage for dual-auth routes
    // (see docs/knowledge on the API-test/UI-test boundary, cmd_658).
    // dual-auth-session-canary: the cy.login() below is the machine-checked
    // exemption (code_generator/check_generated.py rule test:unexplained-login)
    // — do not copy this pattern elsewhere without the same justification.
    it('N14 also authenticates via a NextAuth session cookie (dual-auth)', () => {
      Cypress.session.clearAllSavedSessions();
      cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
      cy.request({ url: `/api/approval_flow/export` }).then((res) => {
        expect(res.status).to.eq(200);
      });
    });
  });
});
