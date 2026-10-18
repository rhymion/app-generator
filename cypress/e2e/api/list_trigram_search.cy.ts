// Hand-written -- not part of the generated entity test set.
// GET /api/<entity>?search=...: the list search box over an entity's trigram search columns
// (role is a cross-entity search target in the default schema, so it is searched by default).
import { TEST_API_KEY } from '../../support/test-credentials';

type Row = { id: string; name?: string };
type Page = { rows: Row[]; total: number };

const list = (query: string) =>
  cy.request({ url: `/api/role?${query}`, headers: { 'X-API-Key': TEST_API_KEY } });

const names = (res: Cypress.Response<unknown>) => ((res.body as Page).rows ?? []).map((r) => r.name);

describe('API: list search over trigram search columns', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    cy.task<Row[]>('db:populateRole', 3);
  });

  it('matches a substring of a search column', () => {
    list('search=Role%202').then((res) => {
      expect(res.status).to.eq(200);
      expect(names(res)).to.deep.equal(['Role 2']);
    });
  });

  it('ignores case', () => {
    list('search=ROLE%203').then((res) => {
      expect(names(res)).to.deep.equal(['Role 3']);
    });
  });

  it('treats % and _ as literal characters', () => {
    list('search=%25').then((res) => {
      expect(res.status).to.eq(200);
      expect(names(res)).to.deep.equal([]);
    });
    list('search=Role_1').then((res) => {
      expect(names(res)).to.deep.equal([]);
    });
  });

  it('applies together with a filter', () => {
    list('search=Role&f.name=Role%201').then((res) => {
      expect(names(res)).to.deep.equal(['Role 1']);
    });
    list('search=Role%202&f.name=Role%201').then((res) => {
      expect(names(res)).to.deep.equal([]);
    });
  });

  it('a text filter on a search column matches a substring', () => {
    list('f.name=ole%202').then((res) => {
      expect(names(res)).to.deep.equal(['Role 2']);
    });
  });

  it('returns every row when the search text is blank', () => {
    list('search=%20').then((res) => {
      expect(names(res)).to.include.members(['Role 1', 'Role 2', 'Role 3']);
    });
  });
});
