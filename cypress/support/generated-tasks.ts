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
    async 'db:populatePersonalNoteDependencies'() {
      const { populatePersonalNoteDependencies } = require('./personal_note/helper');
      return await populatePersonalNoteDependencies();
    },
    async 'db:populatePersonalNote'(length: number) {
      const { populatePersonalNoteData } = require('./personal_note/helper');
      return await populatePersonalNoteData(length);
    },
    async 'db:populatePersonalNoteFull'(length: number) {
      const { populatePersonalNoteFullData } = require('./personal_note/helper');
      return await populatePersonalNoteFullData(length);
    },
    async 'db:getNotificationsForUser'(userId: string) {
      const { prisma } = require('./db-helpers');
      const notifications = await prisma.notification.findMany({ where: { user_id: userId } });
      return JSON.parse(JSON.stringify(notifications));
    },
    // cmd_538: a second user sharing an organization with the seeded test
    // user, so searchMentionUserOptions's org-scope filter surfaces them as
    // a real "@" candidate — needed to prove mention notifications reach
    // someone other than the (self-mentioning) actor.
    async 'db:createMentionCandidateInSameOrg'(name: string) {
      const { prisma } = require('./db-helpers');
      const { TEST_CREDENTIALS } = require('./test-credentials');
      const testUser = await prisma.user.findUnique({ where: { email: TEST_CREDENTIALS.email } });
      if (!testUser) throw new Error('Test user not found. Run db:seed first.');
      const candidate = await prisma.user.create({
        data: {
          name,
          email: `mention-candidate-${Date.now()}-${Math.random()}@example.com`,
          password: 'test-password',
          creator_id: testUser.id,
          updater_id: testUser.id,
        },
      });
      await prisma.organization.create({
        data: {
          name: `Mention Org ${Date.now()}`,
          creator_id: testUser.id,
          updater_id: testUser.id,
          users: { connect: [{ id: testUser.id }, { id: candidate.id }] },
        },
      });
      return JSON.parse(JSON.stringify(candidate));
    },
  };
}
