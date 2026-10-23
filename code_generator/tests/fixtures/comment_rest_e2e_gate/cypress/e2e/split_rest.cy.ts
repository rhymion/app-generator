// Hand-written -- not part of the generated entity test set.
// POST /api/cr_split/{id}/actions/split: the split route of an `x-splittable` entity scoped by organization.
// It changes the record's state and creates records, so it needs the entity's update permission and the
// caller must belong to the record's organization.
import { TEST_API_KEY } from '../../support/test-credentials';

type Split = { id: string; organization_id: string };

const url = (id: string) => `/api/cr_split/${id}/actions/split`;
const asKey = (key = TEST_API_KEY) => ({ 'X-API-Key': key });
const parts = { parts: [{}, {}] };

function split(id: string, key = TEST_API_KEY) {
  return cy.request({ method: 'POST', url: url(id), headers: asKey(key), body: parts, failOnStatusCode: false });
}

function statusOf(id: string) {
  return cy.request({ url: `/api/cr_split/${id}`, headers: asKey() }).then((res) => res.body.status as string);
}

describe('API: split action', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  it('splits the record of a caller who may update it, and creates the parts', () => {
    cy.task<Split[]>('db:populateCrSplit', 1).then(([record]) => {
      split(record.id).its('status').should('eq', 200);
      statusOf(record.id).then((status) => expect(status).to.eq('split'));
      cy.request({ url: '/api/cr_split', headers: asKey() }).then((res) => {
        const rows = res.body.rows as { id: string; status: string }[];
        expect(rows.filter((r) => r.status === 'pending')).to.have.length(2);
      });
    });
  });

  it('rejects a request without credentials and writes nothing', () => {
    cy.task<Split[]>('db:populateCrSplit', 1).then(([record]) => {
      cy.request({ method: 'POST', url: url(record.id), body: parts, failOnStatusCode: false })
        .its('status')
        .should('eq', 401);
      statusOf(record.id).then((status) => expect(status).to.eq('pending'));
    });
  });

  describe('permission', () => {
    it('answers 403 for a caller with no permission on the entity, and writes nothing', () => {
      cy.task<Split[]>('db:populateCrSplit', 1).then(([record]) => {
        cy.task<string>('db:createApiUserWithPermission', {
          entityName: 'cr_split',
          flags: {},
          label: 'noperm',
          organizationId: record.organization_id,
        }).then((key) => {
          split(record.id, key).its('status').should('eq', 403);
          statusOf(record.id).then((status) => expect(status).to.eq('pending'));
        });
      });
    });

    it('answers 403 for a caller who may only read the entity, and writes nothing', () => {
      cy.task<Split[]>('db:populateCrSplit', 1).then(([record]) => {
        cy.task<string>('db:createApiUserWithPermission', {
          entityName: 'cr_split',
          flags: { read: true },
          label: 'readonly',
          organizationId: record.organization_id,
        }).then((key) => {
          split(record.id, key).its('status').should('eq', 403);
          statusOf(record.id).then((status) => expect(status).to.eq('pending'));
        });
      });
    });

    it('lets a caller who can update the entity split it', () => {
      cy.task<Split[]>('db:populateCrSplit', 1).then(([record]) => {
        cy.task<string>('db:createApiUserWithPermission', {
          entityName: 'cr_split',
          flags: { read: true, update: true },
          label: 'updater',
          organizationId: record.organization_id,
        }).then((key) => {
          split(record.id, key).its('status').should('eq', 200);
        });
      });
    });
  });

  describe('organization isolation', () => {
    it('answers 404 for a record of a foreign organization and writes nothing', () => {
      cy.task<Split[]>('db:populateCrSplit', 2).then(([own, foreign]) => {
        cy.task('db:createCrossOrgScenario', { entityName: 'cr_split', entityId: foreign.id }).then(() => {
          split(foreign.id).its('status').should('eq', 404);
          cy.task<string>('db:createApiUserWithPermission', {
            entityName: 'cr_split',
            flags: { read: true, update: true },
            label: 'outsider',
          }).then((key) => {
            // Full permission on the entity, but a member of no organization at all.
            split(own.id, key).its('status').should('eq', 404);
          });
          // The record of the caller's own organization is still reachable.
          split(own.id).its('status').should('eq', 200);
        });
      });
    });
  });
});
