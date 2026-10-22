import { TEST_API_KEY } from '../../../support/test-credentials';

const headers = { 'X-API-Key': TEST_API_KEY };
const FIELD = 'excl_alpha_id';

// x-exclusive-parents [excl_alpha, excl_beta] on two children:
//   excl_owned has its own writable pages and REST route, so it is written through its own
//     service (POST/PUT /api/excl_owned, the Server Action, CSV import);
//   excl_link is written only through its parents' nested writes (PUT/POST /api/excl_alpha).
// A save must leave exactly one of excl_alpha_id / excl_beta_id set: none is 'missing', two
// are 'invalid', both with status 422 and the first listed column in `field`. A PUT replaces
// every column (an omitted one is written as null), so the row after a save is the body's.
type Ids = { alphaId: string; alpha2Id: string; betaId: string };

function post(entity: string, body: object) {
  return cy.request({ method: 'POST', url: `/api/${entity}`, headers, body, failOnStatusCode: false });
}

function put(entity: string, id: string, body: object) {
  return cy.request({ method: 'PUT', url: `/api/${entity}/${id}`, headers, body, failOnStatusCode: false });
}

function get(entity: string, id: string) {
  return cy.request({ url: `/api/${entity}/${id}`, headers }).then((r) => r.body);
}

function expectRejected(r: Cypress.Response<any>, reason: 'missing' | 'invalid') {
  expect(r.status).to.eq(422);
  expect(r.body.code).to.eq('VALIDATION');
  expect(r.body.field).to.eq(FIELD);
  expect(r.body.reason).to.eq(reason);
}

function createOwned(body: object): Cypress.Chainable<string> {
  return post('excl_owned', body).then((r) => {
    expect(r.status).to.eq(201);
    return r.body.id as string;
  });
}

describe('API: x-exclusive-parents rejects a save without exactly one owner', () => {
  let ids: Ids;
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    // Idempotent: db:grantAllPermissions already covers excl_owned (test: true).
    cy.task('db:grantExclOwnedPermission');
    const created = (name: string, entity: string) =>
      post(entity, { name, excl_links: [], excl_owneds: [] }).then((r) => {
        expect(r.status).to.eq(201);
        return r.body.id as string;
      });
    created('Alpha One', 'excl_alpha').then((alphaId) =>
      created('Alpha Two', 'excl_alpha').then((alpha2Id) =>
        created('Beta One', 'excl_beta').then((betaId) => {
          ids = { alphaId, alpha2Id, betaId };
        }),
      ),
    );
  });

  describe('own service: POST/PUT /api/excl_owned', () => {
    it('create with no owner is rejected as missing', () => {
      post('excl_owned', { name: 'none' }).then((r) => expectRejected(r, 'missing'));
    });

    it('create with both owners is rejected as invalid', () => {
      post('excl_owned', { name: 'both', excl_alpha_id: ids.alphaId, excl_beta_id: ids.betaId }).then((r) =>
        expectRejected(r, 'invalid'),
      );
    });

    it('create with exactly one owner is accepted, for either parent', () => {
      createOwned({ name: 'by alpha', excl_alpha_id: ids.alphaId }).then((id) =>
        get('excl_owned', id).then((row) => {
          expect(row.excl_alpha_id).to.eq(ids.alphaId);
          expect(row.excl_beta_id).to.be.null;
        }),
      );
      createOwned({ name: 'by beta', excl_beta_id: ids.betaId }).then((id) =>
        get('excl_owned', id).then((row) => {
          expect(row.excl_beta_id).to.eq(ids.betaId);
          expect(row.excl_alpha_id).to.be.null;
        }),
      );
    });

    it('a rejected create leaves nothing behind', () => {
      post('excl_owned', { name: 'ghost' }).then(() =>
        cy.request({ url: '/api/excl_owned', headers }).then((r) => {
          expect(r.body.rows.map((x: any) => x.name)).to.not.include('ghost');
        }),
      );
    });

    it('an update that sets a second owner next to the first is rejected, and the row is unchanged', () => {
      createOwned({ name: 'row', excl_alpha_id: ids.alphaId }).then((id) => {
        put('excl_owned', id, { name: 'row', excl_alpha_id: ids.alphaId, excl_beta_id: ids.betaId }).then((r) =>
          expectRejected(r, 'invalid'),
        );
        get('excl_owned', id).then((row) => {
          expect(row.excl_alpha_id).to.eq(ids.alphaId);
          expect(row.excl_beta_id).to.be.null;
        });
      });
    });

    it('a PUT replaces every column, so one that omits the owner columns clears them and is rejected as missing', () => {
      createOwned({ name: 'row', excl_alpha_id: ids.alphaId }).then((id) => {
        put('excl_owned', id, { name: 'renamed' }).then((r) => expectRejected(r, 'missing'));
        get('excl_owned', id).then((row) => {
          expect(row.name).to.eq('row');
          expect(row.excl_alpha_id).to.eq(ids.alphaId);
        });
      });
    });

    it('an update that clears the only owner is rejected as missing', () => {
      createOwned({ name: 'row', excl_alpha_id: ids.alphaId }).then((id) => {
        put('excl_owned', id, { name: 'row', excl_alpha_id: null }).then((r) => expectRejected(r, 'missing'));
        get('excl_owned', id).then((row) => expect(row.excl_alpha_id).to.eq(ids.alphaId));
      });
    });

    it('an update that keeps the single owner is accepted', () => {
      createOwned({ name: 'row', excl_alpha_id: ids.alphaId }).then((id) => {
        put('excl_owned', id, { name: 'renamed', excl_alpha_id: ids.alphaId }).then((r) => expect(r.status).to.be.oneOf([200, 204]));
        get('excl_owned', id).then((row) => {
          expect(row.name).to.eq('renamed');
          expect(row.excl_alpha_id).to.eq(ids.alphaId);
        });
      });
    });

    it('moving the row from one parent to the other in one update (one owner before and after) is accepted', () => {
      createOwned({ name: 'row', excl_alpha_id: ids.alphaId }).then((id) => {
        put('excl_owned', id, { name: 'row', excl_alpha_id: null, excl_beta_id: ids.betaId }).then((r) =>
          expect(r.status).to.be.oneOf([200, 204]),
        );
        get('excl_owned', id).then((row) => {
          expect(row.excl_alpha_id).to.be.null;
          expect(row.excl_beta_id).to.eq(ids.betaId);
        });
      });
    });
  });

  describe("nested writes: PUT/POST /api/excl_alpha with excl_links rows", () => {
    const link = (ids: Ids, extra: object = {}) => ({ name: 'link', placed_alpha_id: ids.alphaId, ...extra });

    it('a new row that also names the other parent is rejected on create', () => {
      post('excl_alpha', { name: 'Alpha Nested', excl_links: [link(ids, { excl_beta_id: ids.betaId })], excl_owneds: [] }).then((r) =>
        expectRejected(r, 'invalid'),
      );
    });

    it('a new row that also names the other parent is rejected on update', () => {
      get('excl_alpha', ids.alphaId).then((cur) =>
        put('excl_alpha', ids.alphaId, { ...cur, excl_links: [link(ids, { excl_beta_id: ids.betaId })] }).then((r) => {
          expectRejected(r, 'invalid');
          get('excl_alpha', ids.alphaId).then((after) => expect(after.excl_links).to.have.length(0));
        }),
      );
    });

    it('an existing row sent with the other parent set is rejected, and the row is unchanged', () => {
      get('excl_alpha', ids.alphaId).then((cur) =>
        put('excl_alpha', ids.alphaId, { ...cur, excl_links: [link(ids)] }).then((r) => {
          expect(r.status).to.be.oneOf([200, 204]);
          get('excl_alpha', ids.alphaId).then((withRow) => {
            const row = withRow.excl_links[0];
            put('excl_alpha', ids.alphaId, {
              ...withRow,
              excl_links: [{ id: row.id, name: 'changed', placed_alpha_id: ids.alphaId, excl_beta_id: ids.betaId }],
            }).then((bad) => {
              expectRejected(bad, 'invalid');
              get('excl_alpha', ids.alphaId).then((after) => {
                expect(after.excl_links[0].name).to.eq('link');
                expect(after.excl_links[0].excl_beta_id).to.be.null;
              });
            });
          });
        }),
      );
    });

    it('rows written from the parent with only that parent set are accepted', () => {
      post('excl_alpha', { name: 'Alpha Clean', excl_links: [link(ids)], excl_owneds: [] }).then((r) => {
        expect(r.status).to.eq(201);
        get('excl_alpha', r.body.id).then((row) => {
          expect(row.excl_links).to.have.length(1);
          expect(row.excl_links[0].excl_alpha_id).to.eq(row.id);
          expect(row.excl_links[0].excl_beta_id).to.be.null;
        });
      });
    });

    it('a row that already holds both owners is rejected when saved from a parent screen, not repaired', () => {
      cy.task<string>('db:insertExclLinkWithBothOwners', { name: 'legacy', alphaId: ids.alphaId, betaId: ids.betaId }).then((rowId) =>
        get('excl_alpha', ids.alphaId).then((cur) => {
          expect(cur.excl_links.map((l: any) => l.id)).to.include(rowId);
          put('excl_alpha', ids.alphaId, {
            ...cur,
            excl_links: cur.excl_links.map((l: any) => ({ id: l.id, name: 'renamed', placed_alpha_id: l.placed_alpha_id })),
          }).then((r) => {
            expectRejected(r, 'invalid');
            get('excl_alpha', ids.alphaId).then((after) => {
              const row = after.excl_links.find((l: any) => l.id === rowId);
              expect(row.name).to.eq('legacy');
              expect(row.excl_alpha_id).to.eq(ids.alphaId);
              expect(row.excl_beta_id).to.eq(ids.betaId);
            });
          });
        }),
      );
    });
  });
});
