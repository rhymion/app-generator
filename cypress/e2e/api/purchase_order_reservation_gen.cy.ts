// AUTO-GENERATED - DO NOT EDIT
// x-reservation API e2e tests for entity: purchase_order
import { TEST_API_KEY } from '../../support/test-credentials';

const API_BASE = '/api/purchase_order';

describe('PurchaseOrder Reservation (generated)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  // ---------------------------------------------------------------------------
  // ① 複数アイテム引当成功
  // ---------------------------------------------------------------------------
  it('①: 複数アイテム引当 — inventory_allocation が明細ごとに生成され reserved_quantity が減少する', () => {
    cy.task<any>('db:seedReservationPurchaseOrderMulti').then((seed: any) => {
      cy.request({
        method: 'POST',
        url: API_BASE,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: {
          order_no: 'GEN-TEST-①',
          customer_id: seed.userId,
          items: [
            { product_id: seed.product.id, quantity: 5, price: null },
            { product_id: seed.product.id, quantity: 3, price: null },
          ],
        },
      }).then((res: any) => {
        expect(res.status).to.eq(201);
        const orderId = res.body.id;

        cy.task<number>('db:countPurchaseOrderAllocations', orderId).then((count: number) => {
          expect(count).to.eq(2);
        });

        cy.task<any>('db:getPurchaseOrderPoolState', seed.inventoryRows[0].id).then((inv: any) => {
          expect(inv.reserved_quantity).to.be.gt(0);
        });
      });
    });
  });

  // ---------------------------------------------------------------------------
  // ② 在庫不足 rollback
  // ---------------------------------------------------------------------------
  it('②: 在庫不足 — 409 を返し inventory_allocation が残らない', () => {
    cy.task<any>('db:seedReservationPurchaseOrderInsufficient').then((seed: any) => {
      cy.request({
        method: 'POST',
        url: API_BASE,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: {
          order_no: 'GEN-TEST-②',
          customer_id: seed.userId,
          items: [
            { product_id: seed.product.id, quantity: seed.overQty, price: null },
          ],
        },
        failOnStatusCode: false,
      }).then((res: any) => {
        expect(res.status).to.eq(409);

        cy.task<any>('db:getPurchaseOrderPoolState', seed.inventory.id).then((inv: any) => {
          expect(inv.quantity).to.eq(2);
          expect(inv.reserved_quantity).to.eq(0);
        });
      });
    });
  });

  // ---------------------------------------------------------------------------
  // ③ request.criteria 遵守
  // ---------------------------------------------------------------------------
  it('③: criteria 遵守 — 一致 product_id の inventory のみ引当され不一致は untouched', () => {
    cy.task<any>('db:seedReservationPurchaseOrderCriteria').then((seed: any) => {
      cy.request({
        method: 'POST',
        url: API_BASE,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: {
          order_no: 'GEN-TEST-③',
          customer_id: seed.userId,
          items: [
            { product_id: seed.productMatch.id, quantity: 10, price: null },
          ],
        },
      }).then((res: any) => {
        expect(res.status).to.eq(201);
        const orderId = res.body.id;

        cy.task<any>('db:getPurchaseOrderAllocationsOrdered', orderId).then((allocs: any[]) => {
          expect(allocs).to.have.length(1);
          expect(allocs[0].inventory_id).to.eq(seed.invMatch.id);
        });

        cy.task<any>('db:getPurchaseOrderPoolState', seed.invNoMatch.id).then((inv: any) => {
          expect(inv.reserved_quantity).to.eq(0);
        });
      });
    });
  });

  // ---------------------------------------------------------------------------
  // ④ policy.orderBy 遵守
  // ---------------------------------------------------------------------------
  it('④: orderBy 遵守 — policy 順で最初の inventory から引当される', () => {
    cy.task<any>('db:seedReservationPurchaseOrderOrderBy').then((seed: any) => {
      cy.request({
        method: 'POST',
        url: API_BASE,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: {
          order_no: 'GEN-TEST-④',
          customer_id: seed.userId,
          items: [
            { product_id: seed.product.id, quantity: 50, price: null },
          ],
        },
      }).then((res: any) => {
        expect(res.status).to.eq(201);
        const orderId = res.body.id;

        cy.task<any>('db:getPurchaseOrderAllocationsOrdered', orderId).then((allocs: any[]) => {
          expect(allocs).to.have.length(1);
          // policy: expiration_date asc_nulls_last → lot_number asc → id asc → 最初の row (inv1) から引当
          expect(allocs[0].inventory_id).to.eq(seed.inventoryRows[0].id);
        });
      });
    });
  });
});
