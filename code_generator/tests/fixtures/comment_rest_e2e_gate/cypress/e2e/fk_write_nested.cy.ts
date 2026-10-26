// Hand-written -- not part of the generated entity test set.
// A foreign key carried by a nested child row follows the same rule as the parent's own: cr_group_item.cr_ref_id
// must reference a cr_ref in an organization the caller belongs to AND that the caller may read. Anything else is
// refused with the same 404 a missing row gets, on create and update of the parent (the nested write is reached
// through the same service functions by REST, the Server Actions and both bulk routes).
import { TEST_API_KEY } from '../../support/test-credentials';

type Row = { id: string; organization_id: string };

const asKey = (key = TEST_API_KEY) => ({ 'X-API-Key': key });

describe('API: nested child foreign key writes', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  function withForeignRef(run: (group: Row, foreignRefId: string) => void) {
    cy.task<Row[]>('db:populateCrGroup', 1).then(([group]) => {
      cy.task<Row[]>('db:populateCrRef', 1).then(([ref]) => {
        cy.task<any>('db:createCrossOrgScenario', { entityName: 'cr_ref', entityId: ref.id }).then((scenario) => {
          run(group, scenario.entityInOrgB.id);
        });
      });
    });
  }

  const body = (group: Row, refId: string) => ({
    title: 'Nested FK write',
    organization_id: group.organization_id,
    cr_group_items: [{ name: 'line', cr_ref_id: refId }],
  });

  it('POST refuses a nested cr_ref_id in a foreign organization with 404', () => {
    withForeignRef((group, foreignRefId) => {
      cy.request({ method: 'POST', url: '/api/cr_group', headers: asKey(), body: body(group, foreignRefId), failOnStatusCode: false })
        .its('status')
        .should('eq', 404);
    });
  });

  it('PUT refuses a nested cr_ref_id in a foreign organization with 404 and leaves the record unchanged', () => {
    withForeignRef((group, foreignRefId) => {
      cy.request({ method: 'PUT', url: `/api/cr_group/${group.id}`, headers: asKey(), body: body(group, foreignRefId), failOnStatusCode: false })
        .its('status')
        .should('eq', 404);
      cy.request({ url: `/api/cr_group/${group.id}`, headers: asKey() }).then((res) => {
        expect(JSON.stringify(res.body)).to.not.contain(foreignRefId);
      });
    });
  });

  it('bulk POST reports Not found for a nested cr_ref_id in a foreign organization', () => {
    withForeignRef((group, foreignRefId) => {
      cy.request({ method: 'POST', url: '/api/cr_group/bulk', headers: asKey(), body: [body(group, foreignRefId)], failOnStatusCode: false }).then((res) => {
        expect(res.status).to.eq(207);
        expect(res.body.summary.succeeded).to.eq(0);
        expect(res.body.results[0].error).to.match(/^Not found/);
      });
    });
  });

  it('bulk PUT reports Not found for a nested cr_ref_id in a foreign organization', () => {
    withForeignRef((group, foreignRefId) => {
      cy.request({
        method: 'PUT',
        url: '/api/cr_group/bulk',
        headers: asKey(),
        body: [{ id: group.id, ...body(group, foreignRefId) }],
        failOnStatusCode: false,
      }).then((res) => {
        expect(res.status).to.eq(207);
        expect(res.body.summary.succeeded).to.eq(0);
        expect(res.body.results[0].error).to.match(/^Not found/);
      });
    });
  });

  it('refuses a nested same-organization cr_ref_id the caller has no read permission on', () => {
    cy.task<Row[]>('db:populateCrGroup', 1).then(([group]) => {
      cy.task<Row[]>('db:populateCrRef', 1).then(([ref]) => {
        cy.task<string>('db:createApiUserWithPermission', {
          entityName: 'cr_group',
          flags: { create: true, read: true, update: true },
          label: 'noread',
          organizationId: group.organization_id,
        }).then((key) => {
          cy.request({ method: 'POST', url: '/api/cr_group', headers: asKey(key), body: body(group, ref.id), failOnStatusCode: false })
            .its('status')
            .should('eq', 404);
        });
      });
    });
  });

  it('still accepts a nested cr_ref_id in the caller organization that the caller may read', () => {
    cy.task<Row[]>('db:populateCrGroup', 1).then(([group]) => {
      cy.task<Row[]>('db:populateCrRef', 1).then(([ref]) => {
        cy.request({ method: 'POST', url: '/api/cr_group', headers: asKey(), body: body(group, ref.id) })
          .its('status')
          .should('eq', 201);
        cy.request({ method: 'PUT', url: `/api/cr_group/${group.id}`, headers: asKey(), body: body(group, ref.id) })
          .its('status')
          .should('eq', 200);
      });
    });
  });
});
