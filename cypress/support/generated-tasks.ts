// AUTO-GENERATED - DO NOT EDIT
// Import this in cypress.config.ts and spread into on('task', { ...getGeneratedTasks() })

export function getGeneratedTasks() {
  return {
    async 'db:populateUserDependencies'() {
      const { populateUserDependencies } = require('./user/helper');
      return await populateUserDependencies();
    },
    async 'db:populateUser'(length: number) {
      const { populateUserData } = require('./user/helper');
      return await populateUserData(length);
    },
    async 'db:populateUserFull'(length: number) {
      const { populateUserFullData } = require('./user/helper');
      return await populateUserFullData(length);
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
    async 'db:populateOrganizationDependencies'() {
      const { populateOrganizationDependencies } = require('./organization/helper');
      return await populateOrganizationDependencies();
    },
    async 'db:populateOrganization'(length: number) {
      const { populateOrganizationData } = require('./organization/helper');
      return await populateOrganizationData(length);
    },
    async 'db:populateOrganizationFull'(length: number) {
      const { populateOrganizationFullData } = require('./organization/helper');
      return await populateOrganizationFullData(length);
    },
    async 'db:populatePermissionDependencies'() {
      const { populatePermissionDependencies } = require('./permission/helper');
      return await populatePermissionDependencies();
    },
    async 'db:populatePermission'(length: number) {
      const { populatePermissionData } = require('./permission/helper');
      return await populatePermissionData(length);
    },
    async 'db:populatePermissionFull'(length: number) {
      const { populatePermissionFullData } = require('./permission/helper');
      return await populatePermissionFullData(length);
    },
    async 'db:populateApprovalFlowDependencies'() {
      const { populateApprovalFlowDependencies } = require('./approval_flow/helper');
      return await populateApprovalFlowDependencies();
    },
    async 'db:populateApprovalFlow'(length: number) {
      const { populateApprovalFlowData } = require('./approval_flow/helper');
      return await populateApprovalFlowData(length);
    },
    async 'db:populateApprovalFlowFull'(length: number) {
      const { populateApprovalFlowFullData } = require('./approval_flow/helper');
      return await populateApprovalFlowFullData(length);
    },
    async 'db:populateDashboardDependencies'() {
      const { populateDashboardDependencies } = require('./dashboard/helper');
      return await populateDashboardDependencies();
    },
    async 'db:populateDashboard'(length: number) {
      const { populateDashboardData } = require('./dashboard/helper');
      return await populateDashboardData(length);
    },
    async 'db:populateDashboardFull'(length: number) {
      const { populateDashboardFullData } = require('./dashboard/helper');
      return await populateDashboardFullData(length);
    },
    async 'db:populateDashboardDashboardWidget'(params: { parentId: string; length?: number }) {
      const { populateDashboardDashboardWidgetData } = require('./dashboard/helper');
      return await populateDashboardDashboardWidgetData(params.parentId, params.length || 1);
    },
    async 'db:populateDbTableDependencies'() {
      const { populateDbTableDependencies } = require('./db_table/helper');
      return await populateDbTableDependencies();
    },
    async 'db:populateDbTable'(length: number) {
      const { populateDbTableData } = require('./db_table/helper');
      return await populateDbTableData(length);
    },
    async 'db:populateDbTableFull'(length: number) {
      const { populateDbTableFullData } = require('./db_table/helper');
      return await populateDbTableFullData(length);
    },
    async 'db:populateDbTableField'(params: { parentId: string; length?: number }) {
      const { populateDbTableFieldData } = require('./db_table/helper');
      return await populateDbTableFieldData(params.parentId, params.length || 1);
    },
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
    async 'db:populateSetting1Dependencies'() {
      const { populateSetting1Dependencies } = require('./setting1/helper');
      return await populateSetting1Dependencies();
    },
    async 'db:populateSetting1'(length: number) {
      const { populateSetting1Data } = require('./setting1/helper');
      return await populateSetting1Data(length);
    },
    async 'db:populateSetting1Full'(length: number) {
      const { populateSetting1FullData } = require('./setting1/helper');
      return await populateSetting1FullData(length);
    },
    async 'db:populateSetting1YyyyyYyyyy'(params: { parentId: string; length?: number }) {
      const { populateSetting1YyyyyYyyyyData } = require('./setting1/helper');
      return await populateSetting1YyyyyYyyyyData(params.parentId, params.length || 1);
    },
    async 'db:populateSetting2Dependencies'() {
      const { populateSetting2Dependencies } = require('./setting2/helper');
      return await populateSetting2Dependencies();
    },
    async 'db:populateSetting2'(length: number) {
      const { populateSetting2Data } = require('./setting2/helper');
      return await populateSetting2Data(length);
    },
    async 'db:populateSetting2Full'(length: number) {
      const { populateSetting2FullData } = require('./setting2/helper');
      return await populateSetting2FullData(length);
    },
    async 'db:populateSetting3Dependencies'() {
      const { populateSetting3Dependencies } = require('./setting3/helper');
      return await populateSetting3Dependencies();
    },
    async 'db:populateSetting3'(length: number) {
      const { populateSetting3Data } = require('./setting3/helper');
      return await populateSetting3Data(length);
    },
    async 'db:populateSetting3Full'(length: number) {
      const { populateSetting3FullData } = require('./setting3/helper');
      return await populateSetting3FullData(length);
    },
    async 'db:populateSetting4Dependencies'() {
      const { populateSetting4Dependencies } = require('./setting4/helper');
      return await populateSetting4Dependencies();
    },
    async 'db:populateSetting4'(length: number) {
      const { populateSetting4Data } = require('./setting4/helper');
      return await populateSetting4Data(length);
    },
    async 'db:populateSetting4Full'(length: number) {
      const { populateSetting4FullData } = require('./setting4/helper');
      return await populateSetting4FullData(length);
    },
    async 'db:populateSetting5Dependencies'() {
      const { populateSetting5Dependencies } = require('./setting5/helper');
      return await populateSetting5Dependencies();
    },
    async 'db:populateSetting5'(length: number) {
      const { populateSetting5Data } = require('./setting5/helper');
      return await populateSetting5Data(length);
    },
    async 'db:populateSetting5Full'(length: number) {
      const { populateSetting5FullData } = require('./setting5/helper');
      return await populateSetting5FullData(length);
    },
    async 'db:populateSetting5YyyyyYyyyy'(params: { parentId: string; length?: number }) {
      const { populateSetting5YyyyyYyyyyData } = require('./setting5/helper');
      return await populateSetting5YyyyyYyyyyData(params.parentId, params.length || 1);
    },
    async 'db:populateSetting6Dependencies'() {
      const { populateSetting6Dependencies } = require('./setting6/helper');
      return await populateSetting6Dependencies();
    },
    async 'db:populateSetting6'(length: number) {
      const { populateSetting6Data } = require('./setting6/helper');
      return await populateSetting6Data(length);
    },
    async 'db:populateSetting6Full'(length: number) {
      const { populateSetting6FullData } = require('./setting6/helper');
      return await populateSetting6FullData(length);
    },
    async 'db:populateSetting6YyyyyYyyyy'(params: { parentId: string; length?: number }) {
      const { populateSetting6YyyyyYyyyyData } = require('./setting6/helper');
      return await populateSetting6YyyyyYyyyyData(params.parentId, params.length || 1);
    },
    async 'db:populateSetting7Dependencies'() {
      const { populateSetting7Dependencies } = require('./setting7/helper');
      return await populateSetting7Dependencies();
    },
    async 'db:populateSetting7'(length: number) {
      const { populateSetting7Data } = require('./setting7/helper');
      return await populateSetting7Data(length);
    },
    async 'db:populateSetting7Full'(length: number) {
      const { populateSetting7FullData } = require('./setting7/helper');
      return await populateSetting7FullData(length);
    },
    async 'db:populateSetting8Dependencies'() {
      const { populateSetting8Dependencies } = require('./setting8/helper');
      return await populateSetting8Dependencies();
    },
    async 'db:populateSetting8'(length: number) {
      const { populateSetting8Data } = require('./setting8/helper');
      return await populateSetting8Data(length);
    },
    async 'db:populateSetting8Full'(length: number) {
      const { populateSetting8FullData } = require('./setting8/helper');
      return await populateSetting8FullData(length);
    },
    async 'db:populateProcedureDependencies'() {
      const { populateProcedureDependencies } = require('./procedure/helper');
      return await populateProcedureDependencies();
    },
    async 'db:populateProcedure'(length: number) {
      const { populateProcedureData } = require('./procedure/helper');
      return await populateProcedureData(length);
    },
    async 'db:populateProcedureFull'(length: number) {
      const { populateProcedureFullData } = require('./procedure/helper');
      return await populateProcedureFullData(length);
    },
    async 'db:populateResourceDependencies'() {
      const { populateResourceDependencies } = require('./resource/helper');
      return await populateResourceDependencies();
    },
    async 'db:populateResource'(length: number) {
      const { populateResourceData } = require('./resource/helper');
      return await populateResourceData(length);
    },
    async 'db:populateResourceFull'(length: number) {
      const { populateResourceFullData } = require('./resource/helper');
      return await populateResourceFullData(length);
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
    async 'db:populateShiftTemplateDependencies'() {
      const { populateShiftTemplateDependencies } = require('./shift_template/helper');
      return await populateShiftTemplateDependencies();
    },
    async 'db:populateShiftTemplate'(length: number) {
      const { populateShiftTemplateData } = require('./shift_template/helper');
      return await populateShiftTemplateData(length);
    },
    async 'db:populateShiftTemplateFull'(length: number) {
      const { populateShiftTemplateFullData } = require('./shift_template/helper');
      return await populateShiftTemplateFullData(length);
    },
    async 'db:populateShiftDependencies'() {
      const { populateShiftDependencies } = require('./shift/helper');
      return await populateShiftDependencies();
    },
    async 'db:populateShift'(length: number) {
      const { populateShiftData } = require('./shift/helper');
      return await populateShiftData(length);
    },
    async 'db:populateShiftFull'(length: number) {
      const { populateShiftFullData } = require('./shift/helper');
      return await populateShiftFullData(length);
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
    async 'db:seedReservationPurchaseOrderMulti'() {
      const { seedReservationPurchaseOrderMulti } = require('./purchase_order/reservation_gen_helper');
      return await seedReservationPurchaseOrderMulti();
    },
    async 'db:seedReservationPurchaseOrderInsufficient'() {
      const { seedReservationPurchaseOrderInsufficient } = require('./purchase_order/reservation_gen_helper');
      return await seedReservationPurchaseOrderInsufficient();
    },
    async 'db:seedReservationPurchaseOrderCriteria'() {
      const { seedReservationPurchaseOrderCriteria } = require('./purchase_order/reservation_gen_helper');
      return await seedReservationPurchaseOrderCriteria();
    },
    async 'db:seedReservationPurchaseOrderOrderBy'() {
      const { seedReservationPurchaseOrderOrderBy } = require('./purchase_order/reservation_gen_helper');
      return await seedReservationPurchaseOrderOrderBy();
    },
    async 'db:countPurchaseOrderAllocations'(parentId: string) {
      const { countPurchaseOrderAllocations } = require('./purchase_order/reservation_gen_helper');
      return await countPurchaseOrderAllocations(parentId);
    },
    async 'db:getPurchaseOrderPoolState'(poolId: string) {
      const { getPurchaseOrderPoolState } = require('./purchase_order/reservation_gen_helper');
      return await getPurchaseOrderPoolState(poolId);
    },
    async 'db:getPurchaseOrderAllocationsOrdered'(parentId: string) {
      const { getPurchaseOrderAllocationsOrdered } = require('./purchase_order/reservation_gen_helper');
      return await getPurchaseOrderAllocationsOrdered(parentId);
    },
    async 'db:populateLeaveRequestDependencies'() {
      const { populateLeaveRequestDependencies } = require('./leave_request/helper');
      return await populateLeaveRequestDependencies();
    },
    async 'db:populateLeaveRequest'(length: number) {
      const { populateLeaveRequestData } = require('./leave_request/helper');
      return await populateLeaveRequestData(length);
    },
    async 'db:populateLeaveRequestFull'(length: number) {
      const { populateLeaveRequestFullData } = require('./leave_request/helper');
      return await populateLeaveRequestFullData(length);
    },
    async 'db:setupLeaveRequestApprovalFlow'() {
      const { setupLeaveRequestApprovalFlow } = require('./leave_request/helper');
      return await setupLeaveRequestApprovalFlow();
    },
    async 'db:setupLeaveRequestOrderedApprovalFlow'() {
      const { setupLeaveRequestOrderedApprovalFlow } = require('./leave_request/helper');
      return await setupLeaveRequestOrderedApprovalFlow();
    },
    async 'db:populateLeaveRequestWithApproval'(params: { creatorId: string; approvalFlowIds: string[] }) {
      const { populateLeaveRequestWithApproval } = require('./leave_request/helper');
      return await populateLeaveRequestWithApproval(params.creatorId, params.approvalFlowIds);
    },
    async 'db:populateLeaveRequestWithRejectedApproval'(params: { creatorId: string; approvalFlowIds: string[] }) {
      const { populateLeaveRequestWithRejectedApproval } = require('./leave_request/helper');
      return await populateLeaveRequestWithRejectedApproval(params.creatorId, params.approvalFlowIds);
    },
  };
}
