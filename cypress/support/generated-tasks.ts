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
    async 'db:populatePlanDependencies'() {
      const { populatePlanDependencies } = require('./plan/helper');
      return await populatePlanDependencies();
    },
    async 'db:populatePlan'(length: number) {
      const { populatePlanData } = require('./plan/helper');
      return await populatePlanData(length);
    },
    async 'db:populatePlanFull'(length: number) {
      const { populatePlanFullData } = require('./plan/helper');
      return await populatePlanFullData(length);
    },
    async 'db:populateWorkDependencies'() {
      const { populateWorkDependencies } = require('./work/helper');
      return await populateWorkDependencies();
    },
    async 'db:populateWork'(length: number) {
      const { populateWorkData } = require('./work/helper');
      return await populateWorkData(length);
    },
    async 'db:populateWorkFull'(length: number) {
      const { populateWorkFullData } = require('./work/helper');
      return await populateWorkFullData(length);
    },
    async 'db:populateCharacterDependencies'() {
      const { populateCharacterDependencies } = require('./character/helper');
      return await populateCharacterDependencies();
    },
    async 'db:populateCharacter'(length: number) {
      const { populateCharacterData } = require('./character/helper');
      return await populateCharacterData(length);
    },
    async 'db:populateCharacterFull'(length: number) {
      const { populateCharacterFullData } = require('./character/helper');
      return await populateCharacterFullData(length);
    },
    async 'db:populateSceneDependencies'() {
      const { populateSceneDependencies } = require('./scene/helper');
      return await populateSceneDependencies();
    },
    async 'db:populateScene'(length: number) {
      const { populateSceneData } = require('./scene/helper');
      return await populateSceneData(length);
    },
    async 'db:populateSceneFull'(length: number) {
      const { populateSceneFullData } = require('./scene/helper');
      return await populateSceneFullData(length);
    },
    async 'db:populateMusicDependencies'() {
      const { populateMusicDependencies } = require('./music/helper');
      return await populateMusicDependencies();
    },
    async 'db:populateMusic'(length: number) {
      const { populateMusicData } = require('./music/helper');
      return await populateMusicData(length);
    },
    async 'db:populateMusicFull'(length: number) {
      const { populateMusicFullData } = require('./music/helper');
      return await populateMusicFullData(length);
    },
    async 'db:populateCreatorDependencies'() {
      const { populateCreatorDependencies } = require('./creator/helper');
      return await populateCreatorDependencies();
    },
    async 'db:populateCreator'(length: number) {
      const { populateCreatorData } = require('./creator/helper');
      return await populateCreatorData(length);
    },
    async 'db:populateCreatorFull'(length: number) {
      const { populateCreatorFullData } = require('./creator/helper');
      return await populateCreatorFullData(length);
    },
    async 'db:populateChannelDependencies'() {
      const { populateChannelDependencies } = require('./channel/helper');
      return await populateChannelDependencies();
    },
    async 'db:populateChannel'(length: number) {
      const { populateChannelData } = require('./channel/helper');
      return await populateChannelData(length);
    },
    async 'db:populateChannelFull'(length: number) {
      const { populateChannelFullData } = require('./channel/helper');
      return await populateChannelFullData(length);
    },
    async 'db:populateFcLinkDependencies'() {
      const { populateFcLinkDependencies } = require('./fc_link/helper');
      return await populateFcLinkDependencies();
    },
    async 'db:populateFcLink'(length: number) {
      const { populateFcLinkData } = require('./fc_link/helper');
      return await populateFcLinkData(length);
    },
    async 'db:populateFcLinkFull'(length: number) {
      const { populateFcLinkFullData } = require('./fc_link/helper');
      return await populateFcLinkFullData(length);
    },
    async 'db:populateTipTxDependencies'() {
      const { populateTipTxDependencies } = require('./tip_tx/helper');
      return await populateTipTxDependencies();
    },
    async 'db:populateTipTx'(length: number) {
      const { populateTipTxData } = require('./tip_tx/helper');
      return await populateTipTxData(length);
    },
    async 'db:populateTipTxFull'(length: number) {
      const { populateTipTxFullData } = require('./tip_tx/helper');
      return await populateTipTxFullData(length);
    },
  };
}
