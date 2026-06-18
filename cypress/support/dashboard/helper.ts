// AUTO-GENERATED - DO NOT EDIT
import { prisma, ALL_ENTITIES } from '../db-helpers';
import { TEST_CREDENTIALS } from '../test-credentials';

async function getTestUser() {
  const testUser = await prisma.user.findUnique({
    where: { email: TEST_CREDENTIALS.email },
  });
  if (!testUser) throw new Error('Test user not found. Make sure db:seed has run first.');
  return testUser;
}

export async function populateDashboardDependencies() {
  return {};
}

export async function populateDashboardData(length: number) {
  const testUser = await getTestUser();
  const records = [];
  for (let i = 1; i <= length; i++) {
    const record = await prisma.dashboard.create({
      data: {
        name: `Dashboard ${i}`,
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}

export const populateDashboardFullData = populateDashboardData;

export async function populateDashboardDashboardWidgetData(parentId: string, length: number) {
  const records = [];
  for (let i = 1; i <= length; i++) {
    const record = await prisma.dashboard_widget.create({
      data: {
        dashboard_id: parentId,
        order: i,
        name: `Dashboard Widget ${i}`,
        entity_name: `Test Entity Name ${i}`,
        chart_type: 0,
        stack_mode: 0,
        series_field: `Test Series Field ${i}`,
        group_by_bucket: 0,
        group_by_field: `Test Group By Field ${i}`,
        filter_field: `Test Filter Field ${i}`,
        filter_value: `Test Filter Value ${i}`,
      },
    });
    records.push(record);
  }
  // Serialize Dates to ISO strings so Cypress cy.task can JSON-transfer results
  return JSON.parse(JSON.stringify(records));
}
