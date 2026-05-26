// AUTO-GENERATED - DO NOT EDIT
// Catalog of dashboardable entities and their groupable fields.
// Source: x-display.dashboard flag in code_generator/json_schema.yaml.

export type DashboardField =
  | { name: string; label: string; kind: 'boolean' }
  | { name: string; label: string; kind: 'enum'; enum_values: string[] }
  | { name: string; label: string; kind: 'fk'; fk_target: string; fk_label_field: string };

export type DashboardEntity = {
  name: string;
  label: string;
  groupable_fields: DashboardField[];
};

export const DASHBOARDABLE_ENTITIES: DashboardEntity[] = [
];

export function findDashboardEntity(name: string): DashboardEntity | undefined {
  return DASHBOARDABLE_ENTITIES.find((e) => e.name === name);
}

export function findDashboardField(entityName: string, fieldName: string): DashboardField | undefined {
  return findDashboardEntity(entityName)?.groupable_fields.find((f) => f.name === fieldName);
}
