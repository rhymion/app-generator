import { TEST_API_KEY, TEST_CREDENTIALS } from '../../support/test-credentials';

const API_BASE = '/api/purchase_order';
const INV_API = '/api/inventory';

describe('moveReservation bespoke endpoint (B-5 Phase2d, G15)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  it('O-8/O-4: moves a reservation off a depleted lot, spilling the re-reservation across two inventory lots', () => {
    // Lot 1: default (null) location — quantity 5, so the initial order reserves
    // the full quantity from this single lot (no other lot exists yet).
    cy.task<any>('db:seedReservationInventory', { quantity: 5 }).then((seed) => {
      cy.request({
        method: 'POST',
        url: API_BASE,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: {
          order_no: 'MOVE-001',
          customer_id: seed.customer.id,
          items: [{ product_id: seed.product.id, quantity: 5, price: null }],
        },
      }).then((res) => {
        expect(res.status).to.eq(201);
        const orderId = res.body.id;

        cy.request({
          url: `${INV_API}/${seed.inventory.id}`,
          headers: { 'X-API-Key': TEST_API_KEY },
        }).then((preRes) => {
          expect(preRes.body.quantity).to.eq(5);
          expect(preRes.body.reserved_quantity).to.eq(5);
        });

        // Simulate lot 1's physical stock being depleted elsewhere to 2 (below
        // the 5 the move needs to re-reserve) and add a second lot (location
        // 'LOT-B', quantity 6) so the re-reservation must spill across both.
        cy.task('db:setInventoryQuantity', { inventory_id: seed.inventory.id, quantity: 2 });
        cy.task<any>('db:seedSecondInventoryLot', {
          product_id: seed.product.id,
          quantity: 6,
          location: 'LOT-B',
        }).then((lot2) => {
          cy.task<any>('db:getPurchasePerItemsForOrder', { purchase_order_id: orderId }).then((items) => {
            const item = items[0];
            expect(item.inventory_transactionable_id).to.not.be.null;

            cy.task<any[]>('db:getInventoryTransactionsByBridge', {
              inventory_transactionable_id: item.inventory_transactionable_id,
            }).then((txsBeforeMove) => {
            const beforeIds = new Set(txsBeforeMove.map((t) => t.id));

            Cypress.session.clearAllSavedSessions();
            cy.clearCookies();
            cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
            cy.request({
              method: 'POST',
              url: `${API_BASE}/${orderId}/actions/moveReservation`,
              body: { purchase_per_item_id: item.id },
            }).then((moveRes) => {
              expect(moveRes.status).to.eq(200);
              expect(moveRes.body.message).to.eq('Reservation moved successfully');

              // O-8: the 5 units are now split — 2 re-reserved on lot 1 (all its
              // depleted capacity), 3 re-reserved on the new lot 2.
              cy.request({
                url: `${INV_API}/${seed.inventory.id}`,
                headers: { 'X-API-Key': TEST_API_KEY },
              }).then((lot1Res) => {
                // O-4: quantity is never touched by reserve/cancel — only the
                // depletion we injected manually changed it; the move itself
                // must leave it at 2.
                expect(lot1Res.body.quantity).to.eq(2);
                expect(lot1Res.body.reserved_quantity).to.eq(2);
              });
              cy.request({
                url: `${INV_API}/${lot2.id}`,
                headers: { 'X-API-Key': TEST_API_KEY },
              }).then((lot2Res) => {
                expect(lot2Res.body.quantity).to.eq(6); // O-4: unchanged
                expect(lot2Res.body.reserved_quantity).to.eq(3);
              });

              // Ledger proof: cancel(-5) on lot 1's original (null-location) reserve,
              // plus reserve(+2) on lot 1 and reserve(+3) on lot 2 — net = +5 - 5 + 2 + 3 = 5.
              cy.task<any>('db:getInventoryTransactionsByBridge', {
                inventory_transactionable_id: item.inventory_transactionable_id,
              }).then((allTxs: any[]) => {
                expect(allTxs.length).to.eq(4); // original reserve(5) + cancel(-5) + reserve(2) + reserve(3)

                // Isolate the txs the move itself created (exclude the pre-existing
                // initial reserve tx captured in txsBeforeMove).
                const newTxs = allTxs.filter((t) => !beforeIds.has(t.id));
                expect(newTxs.length).to.eq(3);

                const cancelTx = newTxs.find((t) => t.event_type === 'cancel');
                expect(cancelTx).to.exist;
                expect(cancelTx.reserved_delta).to.eq(-5);
                expect(cancelTx.quantity_delta).to.eq(0);
                // P1-bug regression: the denormalized cancel tx still carries the
                // '' write for the null-location lot (proves the location-normalization
                // fix in the cancel netting/lookup is in effect — see service_after_reject.ts).
                expect(cancelTx.location).to.eq('');

                const newReserveTxs = newTxs.filter((t) => t.event_type === 'reserve');
                expect(newReserveTxs.length).to.eq(2);
                expect(newReserveTxs.every((t) => t.quantity_delta === 0)).to.be.true; // O-4
                const byLot1 = newReserveTxs.filter((t) => t.location === '');
                const byLot2 = newReserveTxs.filter((t) => t.location === 'LOT-B');
                expect(byLot1.length).to.eq(1);
                expect(byLot1[0].reserved_delta).to.eq(2);
                expect(byLot2.length).to.eq(1);
                expect(byLot2[0].reserved_delta).to.eq(3);

                const netSum = allTxs.reduce((s, t) => s + t.reserved_delta, 0);
                expect(netSum).to.eq(5); // outstanding reservation unchanged by the move
              });
            });
            });
          });
        });
      });
    });
  });

  it('409 INSUFFICIENT_INVENTORY: rolls back atomically when no lot combination covers the reservation', () => {
    cy.task<any>('db:seedReservationInventory', { quantity: 5 }).then((seed) => {
      cy.request({
        method: 'POST',
        url: API_BASE,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: {
          order_no: 'MOVE-002',
          customer_id: seed.customer.id,
          items: [{ product_id: seed.product.id, quantity: 5, price: null }],
        },
      }).then((res) => {
        expect(res.status).to.eq(201);
        const orderId = res.body.id;

        // Deplete lot 1 to 1 unit of available capacity with no other lot to spill onto.
        cy.task('db:setInventoryQuantity', { inventory_id: seed.inventory.id, quantity: 1 });

        cy.task<any>('db:getPurchasePerItemsForOrder', { purchase_order_id: orderId }).then((items) => {
          const item = items[0];

          Cypress.session.clearAllSavedSessions();
          cy.clearCookies();
          cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
          cy.request({
            method: 'POST',
            url: `${API_BASE}/${orderId}/actions/moveReservation`,
            body: { purchase_per_item_id: item.id },
            failOnStatusCode: false,
          }).then((moveRes) => {
            expect(moveRes.status).to.eq(409);
            expect(moveRes.body.code).to.eq('INSUFFICIENT_INVENTORY');
            expect(moveRes.body.available).to.eq(1);
            expect(moveRes.body.required).to.eq(5);

            // Rollback proof: the original reservation is untouched — no cancel tx
            // was committed, and lot 1's reserved_quantity still reflects the
            // pre-move 5 units (approvable stays pending; this was never a reject).
            cy.task<any>('db:getInventoryTransactionsByBridge', {
              inventory_transactionable_id: item.inventory_transactionable_id,
            }).then((txs: any[]) => {
              expect(txs.length).to.eq(1); // only the original reserve — cancel rolled back
              expect(txs[0].event_type).to.eq('reserve');
            });
          });
        });
      });
    });
  });

  it('404: rejects a purchase_per_item_id that does not belong to the given purchase_order', () => {
    cy.task<any>('db:seedReservationInventory', { quantity: 5 }).then((seed) => {
      cy.request({
        method: 'POST',
        url: API_BASE,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: {
          order_no: 'MOVE-003',
          customer_id: seed.customer.id,
          items: [{ product_id: seed.product.id, quantity: 5, price: null }],
        },
      }).then((res) => {
        const orderId = res.body.id;

        Cypress.session.clearAllSavedSessions();
        cy.clearCookies();
        cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
        cy.request({
          method: 'POST',
          url: `${API_BASE}/${orderId}/actions/moveReservation`,
          body: { purchase_per_item_id: 'nonexistent-id' },
          failOnStatusCode: false,
        }).then((moveRes) => {
          expect(moveRes.status).to.eq(404);
        });
      });
    });
  });
});
