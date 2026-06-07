import { TEST_API_KEY } from '../../support/test-credentials';

const API_BASE = '/api/purchase_order';
const INV_API = '/api/inventory';

describe('Reservation Allocation (B3/B4)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  // -------------------------------------------------------------------------
  // B3: inventory decrement + allocation row + insufficient inventory
  // -------------------------------------------------------------------------

  it('R1: successful order decrements inventory and creates allocation row', () => {
    cy.task<any>('db:seedReservationInventory', { quantity: 10 }).then((seed) => {
      cy.request({
        method: 'POST',
        url: API_BASE,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: {
          order_no: 'RES-001',
          customer_id: seed.customer.id,
          items: [{ product_id: seed.product.id, quantity: 3, price: null }],
        },
      }).then((res) => {
        expect(res.status).to.eq(201);
        const orderId = res.body.id;

        cy.request({
          url: `${INV_API}/${seed.inventory.id}`,
          headers: { 'X-API-Key': TEST_API_KEY },
        }).then((invRes) => {
          expect(invRes.status).to.eq(200);
          expect(invRes.body.quantity).to.eq(7);
          expect(invRes.body.reserved_quantity).to.eq(3);
        });

        cy.task<any>('db:getInventoryAllocation', { purchase_order_id: orderId }).then((alloc) => {
          expect(alloc).to.not.be.null;
          expect(alloc.quantity).to.eq(3);
          expect(alloc.inventory_id).to.eq(seed.inventory.id);
        });
      });
    });
  });

  it('R2: rejects order when inventory insufficient — returns 409, inventory unchanged', () => {
    cy.task<any>('db:seedReservationInventory', { quantity: 2 }).then((seed) => {
      cy.request({
        method: 'POST',
        url: API_BASE,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: {
          order_no: 'RES-002',
          customer_id: seed.customer.id,
          items: [{ product_id: seed.product.id, quantity: 5, price: null }],
        },
        failOnStatusCode: false,
      }).then((res) => {
        expect(res.status).to.eq(409);

        cy.request({
          url: `${INV_API}/${seed.inventory.id}`,
          headers: { 'X-API-Key': TEST_API_KEY },
        }).then((invRes) => {
          expect(invRes.body.quantity).to.eq(2);
          expect(invRes.body.reserved_quantity).to.eq(0);
        });
      });
    });
  });

  // -------------------------------------------------------------------------
  // B4/B6: true concurrent depletion — 2 requests fired simultaneously
  //        one must succeed (201), one must fail (409), inventory stays >= 0
  // -------------------------------------------------------------------------

  it('R3 (B6-concurrent): two simultaneous orders for last unit → exactly [201, 409]', () => {
    cy.task<any>('db:seedReservationInventory', { quantity: 1 }).then((seed) => {
      // Use cy.window() to get the fetch API, then fire both requests in parallel
      // via Promise.all so they hit the server at the same time.
      cy.wrap(
        Promise.all([
          fetch(`${Cypress.config('baseUrl')}${API_BASE}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': TEST_API_KEY,
            },
            body: JSON.stringify({
              order_no: 'RES-003A',
              customer_id: seed.customer.id,
              items: [{ product_id: seed.product.id, quantity: 1, price: null }],
            }),
          }),
          fetch(`${Cypress.config('baseUrl')}${API_BASE}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': TEST_API_KEY,
            },
            body: JSON.stringify({
              order_no: 'RES-003B',
              customer_id: seed.customer.id,
              items: [{ product_id: seed.product.id, quantity: 1, price: null }],
            }),
          }),
        ])
      ).then(([res1, res2]: [Response, Response]) => {
        const statuses = [res1.status, res2.status].sort();
        expect(statuses).to.deep.equal([201, 409]);

        cy.request({
          url: `${INV_API}/${seed.inventory.id}`,
          headers: { 'X-API-Key': TEST_API_KEY },
        }).then((invRes) => {
          expect(invRes.body.quantity).to.be.gte(0);
          expect(invRes.body.quantity).to.eq(0);
        });
      });
    });
  });

  // -------------------------------------------------------------------------
  // B1: update guard + delete guard
  // -------------------------------------------------------------------------

  it('R4 (B1 update guard): PUT with changed item quantity after allocation → 409', () => {
    cy.task<any>('db:seedReservationInventory', { quantity: 10 }).then((seed) => {
      cy.request({
        method: 'POST',
        url: API_BASE,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: {
          order_no: 'RES-004',
          customer_id: seed.customer.id,
          items: [{ product_id: seed.product.id, quantity: 2, price: null }],
        },
      }).then((res) => {
        expect(res.status).to.eq(201);
        const orderId = res.body.id;

        cy.request({
          url: `${API_BASE}/${orderId}`,
          headers: { 'X-API-Key': TEST_API_KEY },
        }).then((detailRes) => {
          const items = detailRes.body.items;
          cy.request({
            method: 'PUT',
            url: `${API_BASE}/${orderId}`,
            headers: { 'X-API-Key': TEST_API_KEY },
            body: {
              order_no: 'RES-004',
              customer_id: seed.customer.id,
              items: items.map((item: any) => ({ ...item, quantity: 5 })),
            },
            failOnStatusCode: false,
          }).then((putRes) => {
            expect(putRes.status).to.eq(409);
          });
        });
      });
    });
  });

  it('R5 (B1 delete guard): DELETE with existing allocation → 409', () => {
    cy.task<any>('db:seedReservationInventory', { quantity: 10 }).then((seed) => {
      cy.request({
        method: 'POST',
        url: API_BASE,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: {
          order_no: 'RES-005',
          customer_id: seed.customer.id,
          items: [{ product_id: seed.product.id, quantity: 2, price: null }],
        },
      }).then((res) => {
        expect(res.status).to.eq(201);
        const orderId = res.body.id;

        cy.request({
          method: 'DELETE',
          url: `${API_BASE}/${orderId}`,
          headers: { 'X-API-Key': TEST_API_KEY },
          failOnStatusCode: false,
        }).then((delRes) => {
          expect(delRes.status).to.eq(409);
        });
      });
    });
  });

  it('R6 (B1 update guard): non-criteria field update (order_no) allowed after allocation', () => {
    cy.task<any>('db:seedReservationInventory', { quantity: 10 }).then((seed) => {
      cy.request({
        method: 'POST',
        url: API_BASE,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: {
          order_no: 'RES-006-original',
          customer_id: seed.customer.id,
          items: [{ product_id: seed.product.id, quantity: 2, price: null }],
        },
      }).then((res) => {
        expect(res.status).to.eq(201);
        const orderId = res.body.id;

        cy.request({
          url: `${API_BASE}/${orderId}`,
          headers: { 'X-API-Key': TEST_API_KEY },
        }).then((detailRes) => {
          const items = detailRes.body.items;
          cy.request({
            method: 'PUT',
            url: `${API_BASE}/${orderId}`,
            headers: { 'X-API-Key': TEST_API_KEY },
            body: {
              order_no: 'RES-006-updated',
              customer_id: seed.customer.id,
              items,
            },
          }).then((putRes) => {
            expect(putRes.status).to.eq(200);
          });
        });
      });
    });
  });
});
