'use server';

import { canAccessEntity, getSessionUserIdOrThrow } from '@/lib/authz';
import { DASHBOARDABLE_ENTITIES } from './catalog';

/**
 * Names of the dashboard-catalog entities (`x-display.dashboard: true`) the signed-in user may read.
 * The widget editor offers exactly these as data sources.
 */
export async function getReadableDashboardEntityNames(): Promise<string[]> {
  const userId = await getSessionUserIdOrThrow();
  const readable = await Promise.all(
    DASHBOARDABLE_ENTITIES.map(async (e) => ((await canAccessEntity(e.name, 'read', userId)) ? e.name : null)),
  );
  return readable.filter((name): name is string => name !== null);
}
