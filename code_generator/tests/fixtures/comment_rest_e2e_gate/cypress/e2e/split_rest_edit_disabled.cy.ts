// Hand-written -- not part of the generated entity test set.
// POST /api/<entity>/{id}/actions/split for `x-splittable` entities whose editing is disabled
// (`x-generate.edit: false`). The update permission can never be assigned to such an entity, so the
// split route asks for the strongest permission the entity can hold: `create` when new records are
// enabled (cr_split_create), `read` when they are not either (cr_split_read). The caller must still
// belong to the record's organization.
import { TEST_API_KEY } from '../../support/test-credentials';

type Split = { id: string; organization_id: string };
type Flags = { read?: boolean; create?: boolean };

const asKey = (key = TEST_API_KEY) => ({ 'X-API-Key': key });
const parts = { parts: [{}, {}] };

function split(entity: string, id: string, key = TEST_API_KEY) {
  return cy.request({
    method: 'POST',
    url: `/api/${entity}/${id}/actions/split`,
    headers: asKey(key),
    body: parts,
    failOnStatusCode: false,
  });
}

function statusOf(entity: string, id: string) {
  return cy.request({ url: `/api/${entity}/${id}`, headers: asKey() }).then((res) => res.body.status as string);
}

function populate(entity: string, count: number) {
  const task = `db:populate${entity.replace(/(^|_)(\w)/g, (_m, _s, c: string) => c.toUpperCase())}`;
  return cy.task<Split[]>(task, count);
}

const variants: { entity: string; tier: string; allowed: Flags; refused: { label: string; flags: Flags }[] }[] = [
  {
    entity: 'cr_split_create',
    tier: 'create',
    allowed: { read: true, create: true },
    refused: [
      { label: 'noperm', flags: {} },
      { label: 'readonly', flags: { read: true } },
    ],
  },
  {
    entity: 'cr_split_read',
    tier: 'read',
    allowed: { read: true },
    refused: [{ label: 'noperm', flags: {} }],
  },
];

variants.forEach(({ entity, tier, allowed, refused }) => {
  describe(`API: split action of an entity without editing (${entity}, requires ${tier})`, () => {
    beforeEach(() => {
      cy.task('db:reset');
      cy.task('db:seed');
      cy.task('db:grantAllPermissions');
    });

    it(`lets a caller who holds only the ${tier} permission split the record`, () => {
      populate(entity, 1).then(([record]) => {
        cy.task<string>('db:createApiUserWithPermission', {
          entityName: entity,
          flags: allowed,
          label: `${tier}-only`,
          organizationId: record.organization_id,
        }).then((key) => {
          split(entity, record.id, key).its('status').should('eq', 200);
          statusOf(entity, record.id).then((status) => expect(status).to.eq('split'));
        });
      });
    });

    refused.forEach(({ label, flags }) => {
      it(`answers 403 for a caller with ${label === 'noperm' ? 'no permission' : 'read access only'}, and writes nothing`, () => {
        populate(entity, 1).then(([record]) => {
          cy.task<string>('db:createApiUserWithPermission', {
            entityName: entity,
            flags,
            label,
            organizationId: record.organization_id,
          }).then((key) => {
            split(entity, record.id, key).its('status').should('eq', 403);
            statusOf(entity, record.id).then((status) => expect(status).to.eq('pending'));
          });
        });
      });
    });

    it('rejects a request without credentials and writes nothing', () => {
      populate(entity, 1).then(([record]) => {
        cy.request({
          method: 'POST',
          url: `/api/${entity}/${record.id}/actions/split`,
          body: parts,
          failOnStatusCode: false,
        })
          .its('status')
          .should('eq', 401);
        statusOf(entity, record.id).then((status) => expect(status).to.eq('pending'));
      });
    });

    it('answers 404 to a caller of another organization', () => {
      populate(entity, 2).then(([own, foreign]) => {
        cy.task('db:createCrossOrgScenario', { entityName: entity, entityId: foreign.id }).then(() => {
          split(entity, foreign.id).its('status').should('eq', 404);
          cy.task<string>('db:createApiUserWithPermission', {
            entityName: entity,
            flags: allowed,
            label: 'outsider',
          }).then((key) => {
            // Holds the tier's permission, but is a member of no organization at all.
            split(entity, own.id, key).its('status').should('eq', 404);
          });
        });
      });
    });
  });
});
