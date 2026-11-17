import { TEST_API_KEY } from '../../../support/test-credentials';

// Field-level validation on parent1 through POST /api/parent1:
//   #1271  declared range (price: minimum 0, maximum 1000000) and JSON type checks;
//   #1273  declared maxLength (name: 100);
//   #1393  description is @db.VarChar(200), shorter than its 65535 server maxLength: a longer
//          value passes service validation, is refused by PostgreSQL (P2000) and must come back
//          as a VALIDATION error saying the value is too long, not the generic invalid-value one.
// Every refusal answers 422 and creates no row.
const headers = { 'X-API-Key': TEST_API_KEY };

let seq = 0;
function body(over: Record<string, unknown> = {}) {
  seq += 1;
  return {
    name: `field-validation-${Date.now()}-${seq}`,
    price: 10,
    due_date: '2026-12-01T00:00:00.000Z',
    parent1_child1s: [],
    parent1_child2s: [],
    ...over,
  };
}

function post(b: object) {
  return cy.request({ method: 'POST', url: '/api/parent1', headers, body: b, failOnStatusCode: false });
}

function total(): Cypress.Chainable<number> {
  return cy.request({ url: '/api/parent1?pageSize=1', headers }).then((r) => r.body.total as number);
}

function expectRefused(b: object, field: string | undefined, message: RegExp) {
  total().then((before) => {
    post(b).then((r) => {
      expect(r.status).to.eq(422);
      expect(r.body.code).to.eq('VALIDATION');
      expect(r.body.reason).to.eq('invalid');
      if (field) expect(r.body.field).to.eq(field);
      expect(JSON.stringify(r.body)).to.match(message);
    });
    total().should('eq', before);
  });
}

describe('API: field-level validation on parent1', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  it('accepts a body inside every declared rule', () => {
    post(body({ description: 'd'.repeat(200), price: 1000000 })).then((r) => expect(r.status).to.eq(201));
  });

  it('#1271: refuses a value outside the declared range', () => {
    expectRefused(body({ price: -1 }), 'price', /Price must be at least 0/);
    expectRefused(body({ price: 1000001 }), 'price', /Price must be at most 1000000/);
  });

  it('#1271: refuses a value of the wrong JSON type', () => {
    expectRefused(body({ price: '10' }), 'price', /Price must be an integer/);
    expectRefused(body({ price: 1.5 }), 'price', /Price must be an integer/);
  });

  it('#1273: refuses a name longer than its declared maxLength', () => {
    expectRefused(body({ name: 'n'.repeat(101) }), 'name', /at most 100 characters/);
  });

  it('#1393: reports a value longer than the VarChar column as too long', () => {
    total().then((before) => {
      post(body({ description: 'd'.repeat(201) })).then((r) => {
        expect(r.status).to.eq(422);
        expect(r.body.code).to.eq('VALIDATION');
        expect(r.body.reason).to.eq('invalid');
        expect(JSON.stringify(r.body)).to.match(/too long/);
        // PostgreSQL reports the column for 22001 only sometimes; when it does, it is this one.
        if (r.body.field !== undefined && r.body.field !== null) expect(r.body.field).to.eq('description');
      });
      total().should('eq', before);
    });
  });
});
