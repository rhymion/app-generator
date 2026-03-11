// AUTO-GENERATED - DO NOT EDIT
// Import this in cypress.config.ts and spread into on('task', { ...getGeneratedTasks() })

export function getGeneratedTasks() {
  return {
    async 'db:populateXxxxxXxxxxDependencies'() {
      const { populateXxxxxXxxxxDependencies } = require('./xxxxx_xxxxx/helper');
      return await populateXxxxxXxxxxDependencies();
    },
    async 'db:populateXxxxxXxxxx'(length: number) {
      const { populateXxxxxXxxxxData } = require('./xxxxx_xxxxx/helper');
      return await populateXxxxxXxxxxData(length);
    },
    async 'db:populateXxxxxXxxxxFull'(length: number) {
      const { populateXxxxxXxxxxFullData } = require('./xxxxx_xxxxx/helper');
      return await populateXxxxxXxxxxFullData(length);
    },
    async 'db:populateXxxxxXxxxxYyyyyYyyyy'(params: { parentId: string; length?: number }) {
      const { populateXxxxxXxxxxYyyyyYyyyyData } = require('./xxxxx_xxxxx/helper');
      return await populateXxxxxXxxxxYyyyyYyyyyData(params.parentId, params.length || 1);
    },
    async 'db:populateParentOnlyDependencies'() {
      const { populateParentOnlyDependencies } = require('./parent_only/helper');
      return await populateParentOnlyDependencies();
    },
    async 'db:populateParentOnly'(length: number) {
      const { populateParentOnlyData } = require('./parent_only/helper');
      return await populateParentOnlyData(length);
    },
    async 'db:populateParentOnlyFull'(length: number) {
      const { populateParentOnlyFullData } = require('./parent_only/helper');
      return await populateParentOnlyFullData(length);
    },
    async 'db:populateRoleDependencies'() {
      const { populateRoleDependencies } = require('./role/helper');
      return await populateRoleDependencies();
    },
    async 'db:populateRole'(length: number) {
      const { populateRoleData } = require('./role/helper');
      return await populateRoleData(length);
    },
    async 'db:populateRoleFull'(length: number) {
      const { populateRoleFullData } = require('./role/helper');
      return await populateRoleFullData(length);
    },
    async 'db:populateBookingDependencies'() {
      const { populateBookingDependencies } = require('./booking/helper');
      return await populateBookingDependencies();
    },
    async 'db:populateBooking'(length: number) {
      const { populateBookingData } = require('./booking/helper');
      return await populateBookingData(length);
    },
    async 'db:populateBookingFull'(length: number) {
      const { populateBookingFullData } = require('./booking/helper');
      return await populateBookingFullData(length);
    },
    async 'db:populateProductDependencies'() {
      const { populateProductDependencies } = require('./product/helper');
      return await populateProductDependencies();
    },
    async 'db:populateProduct'(length: number) {
      const { populateProductData } = require('./product/helper');
      return await populateProductData(length);
    },
    async 'db:populateProductFull'(length: number) {
      const { populateProductFullData } = require('./product/helper');
      return await populateProductFullData(length);
    },
    async 'db:populateInventoryDependencies'() {
      const { populateInventoryDependencies } = require('./inventory/helper');
      return await populateInventoryDependencies();
    },
    async 'db:populateInventory'(length: number) {
      const { populateInventoryData } = require('./inventory/helper');
      return await populateInventoryData(length);
    },
    async 'db:populateInventoryFull'(length: number) {
      const { populateInventoryFullData } = require('./inventory/helper');
      return await populateInventoryFullData(length);
    },
    async 'db:populatePurchaseOrderDependencies'() {
      const { populatePurchaseOrderDependencies } = require('./purchase_order/helper');
      return await populatePurchaseOrderDependencies();
    },
    async 'db:populatePurchaseOrder'(length: number) {
      const { populatePurchaseOrderData } = require('./purchase_order/helper');
      return await populatePurchaseOrderData(length);
    },
    async 'db:populatePurchaseOrderFull'(length: number) {
      const { populatePurchaseOrderFullData } = require('./purchase_order/helper');
      return await populatePurchaseOrderFullData(length);
    },
    async 'db:populatePurchaseOrderPurchasePerItem'(params: { parentId: string; length?: number }) {
      const { populatePurchaseOrderPurchasePerItemData } = require('./purchase_order/helper');
      return await populatePurchaseOrderPurchasePerItemData(params.parentId, params.length || 1);
    },
  };
}
