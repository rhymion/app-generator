// Hand-written -- not part of the generated entity test set.
// A foreign key may only point at a row the caller can reach: cr_note.cr_ref_id must reference a
// cr_ref in an organization the caller belongs to AND that the caller may read. Anything else is
// refused with the same 404 a missing row gets, on create, update and both bulk routes.
import { TEST_API_KEY } from '../../support/test-credentials';

type Row = { id: string; organization_id: string };

const asKey = (key = TEST_API_KEY) => ({ 'X-API-Key': key });

describe('API: foreign key writes', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  // A note in the caller's organization plus a ref in another organization.
  function withForeignRef(run: (note: Row, foreignRefId: string) => void) {
    cy.task<Row[]>('db:populateCrNote', 1).then(([note]) => {
      cy.task<Row[]>('db:populateCrRef', 1).then(([ref]) => {
        cy.task<any>('db:createCrossOrgScenario', { entityName: 'cr_ref', entityId: ref.id }).then((scenario) => {
          run(note, scenario.entityInOrgB.id);
        });
      });
    });
  }

  const body = (note: Row, refId: string) => ({
    title: 'FK write',
    organization_id: note.organization_id,
    cr_ref_id: refId,
  });

  it('POST refuses a cr_ref_id in a foreign organization with 404', () => {
    withForeignRef((note, foreignRefId) => {
      cy.request({ method: 'POST', url: '/api/cr_note', headers: asKey(), body: body(note, foreignRefId), failOnStatusCode: false })
        .its('status')
        .should('eq', 404);
    });
  });

  it('PUT refuses a cr_ref_id in a foreign organization with 404 and leaves the record unchanged', () => {
    withForeignRef((note, foreignRefId) => {
      cy.request({ method: 'PUT', url: `/api/cr_note/${note.id}`, headers: asKey(), body: body(note, foreignRefId), failOnStatusCode: false })
        .its('status')
        .should('eq', 404);
      cy.request({ url: `/api/cr_note/${note.id}`, headers: asKey() }).then((res) => {
        expect(JSON.stringify(res.body)).to.not.contain(foreignRefId);
      });
    });
  });

  it('bulk POST reports Not found for a cr_ref_id in a foreign organization', () => {
    withForeignRef((note, foreignRefId) => {
      cy.request({ method: 'POST', url: '/api/cr_note/bulk', headers: asKey(), body: [body(note, foreignRefId)], failOnStatusCode: false }).then((res) => {
        expect(res.status).to.eq(207);
        expect(res.body.summary.succeeded).to.eq(0);
        expect(res.body.results[0].error).to.match(/^Not found/);
      });
    });
  });

  it('bulk PUT reports Not found for a cr_ref_id in a foreign organization', () => {
    withForeignRef((note, foreignRefId) => {
      cy.request({
        method: 'PUT',
        url: '/api/cr_note/bulk',
        headers: asKey(),
        body: [{ id: note.id, ...body(note, foreignRefId) }],
        failOnStatusCode: false,
      }).then((res) => {
        expect(res.status).to.eq(207);
        expect(res.body.summary.succeeded).to.eq(0);
        expect(res.body.results[0].error).to.match(/^Not found/);
      });
    });
  });

  it('refuses a same-organization cr_ref_id the caller has no read permission on', () => {
    cy.task<Row[]>('db:populateCrNote', 1).then(([note]) => {
      cy.task<Row[]>('db:populateCrRef', 1).then(([ref]) => {
        cy.task<string>('db:createApiUserWithPermission', {
          entityName: 'cr_note',
          flags: { create: true, read: true, update: true },
          label: 'noread',
          organizationId: note.organization_id,
        }).then((key) => {
          cy.request({ method: 'POST', url: '/api/cr_note', headers: asKey(key), body: body(note, ref.id), failOnStatusCode: false })
            .its('status')
            .should('eq', 404);
        });
      });
    });
  });

  it('still accepts a cr_ref_id in the caller organization that the caller may read', () => {
    cy.task<Row[]>('db:populateCrNote', 1).then(([note]) => {
      cy.task<Row[]>('db:populateCrRef', 1).then(([ref]) => {
        cy.request({ method: 'POST', url: '/api/cr_note', headers: asKey(), body: body(note, ref.id) })
          .its('status')
          .should('eq', 201);
        cy.request({ method: 'PUT', url: `/api/cr_note/${note.id}`, headers: asKey(), body: body(note, ref.id) })
          .its('status')
          .should('eq', 200);
      });
    });
  });
});
