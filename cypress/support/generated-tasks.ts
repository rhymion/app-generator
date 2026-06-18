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
  };
}
