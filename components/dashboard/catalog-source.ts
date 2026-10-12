// The dashboard catalog is generated (lib/dashboard/catalog.ts) and absent on a clean checkout. Importing it
// through this module lets the editor's unit tests mock the catalog without resolving the generated file.
export { DASHBOARDABLE_ENTITIES, findDashboardEntity } from '@/lib/dashboard/catalog';
