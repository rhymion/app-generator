import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/app/generated/prisma/client';
import { TEST_CREDENTIALS } from './test-credentials';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: `${process.env.DATABASE_URL}` }) });

/**
 * Inserts a dashboard with one widget straight into the database. The save API validates widgets against the
 * schema's dashboard data sources, so it cannot be used to store a widget whose data source is not (or no longer)
 * available -- the state a schema change leaves behind.
 */
export async function seedDashboardWithWidget(params: { entityName: string; groupByField: string; widgetName: string }) {
  const user = await prisma.user.findFirstOrThrow({ where: { email: TEST_CREDENTIALS.email } });
  const dashboard = await prisma.dashboard.create({
    data: {
      name: 'Editor Dashboard',
      creator_id: user.id,
      updater_id: user.id,
      widgets: {
        create: [{ name: params.widgetName, entity_name: params.entityName, group_by_field: params.groupByField, chart_type: 'column', order: 0 }],
      },
    },
  });
  return dashboard.id;
}
