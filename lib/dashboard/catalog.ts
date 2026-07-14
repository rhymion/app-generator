// AUTO-GENERATED - DO NOT EDIT
// Catalog of dashboardable entities and their groupable fields.
// Source: x-display.dashboard flag in code_generator/json_schema.yaml.

export type DashboardField =
  | { name: string; label: string; kind: 'boolean' }
  | { name: string; label: string; kind: 'enum'; enum_values: string[] }
  | { name: string; label: string; kind: 'fk'; fk_target: string; fk_label_field: string }
  | { name: string; label: string; kind: 'number' }
  | { name: string; label: string; kind: 'datetime'; datetime_format: 'date' | 'date-time' };

export type DashboardEntity = {
  name: string;
  label: string;
  groupable_fields: DashboardField[];
};

export const DASHBOARDABLE_ENTITIES: DashboardEntity[] = [
  {
    name: 'resource',
    label: 'Resource',
    groupable_fields: [
      { name: 'organization_id', label: 'Organization', kind: 'fk', fk_target: 'organization', fk_label_field: 'name' },
      { name: 'creator_id', label: 'Creator', kind: 'fk', fk_target: 'user', fk_label_field: 'name' },
      { name: 'updater_id', label: 'Updater', kind: 'fk', fk_target: 'user', fk_label_field: 'name' },
    ],
  },
  {
    name: 'booking',
    label: 'Booking',
    groupable_fields: [
      { name: 'resource_id', label: 'Resource', kind: 'fk', fk_target: 'resource', fk_label_field: 'name' },
      { name: 'start_time', label: 'Start Time', kind: 'datetime', datetime_format: 'date-time' },
      { name: 'end_time', label: 'End Time', kind: 'datetime', datetime_format: 'date-time' },
      { name: 'creator_id', label: 'Creator', kind: 'fk', fk_target: 'user', fk_label_field: 'name' },
      { name: 'updater_id', label: 'Updater', kind: 'fk', fk_target: 'user', fk_label_field: 'name' },
    ],
  },
  {
    name: 'product',
    label: 'Product',
    groupable_fields: [
      { name: 'price', label: 'Price', kind: 'number' },
      { name: 'creator_id', label: 'Creator', kind: 'fk', fk_target: 'user', fk_label_field: 'name' },
      { name: 'updater_id', label: 'Updater', kind: 'fk', fk_target: 'user', fk_label_field: 'name' },
    ],
  },
  {
    name: 'leave_request',
    label: 'Leave Request',
    groupable_fields: [
      { name: 'user_id', label: 'User', kind: 'fk', fk_target: 'user', fk_label_field: 'name' },
      { name: 'start_date', label: 'Start Date', kind: 'datetime', datetime_format: 'date' },
      { name: 'end_date', label: 'End Date', kind: 'datetime', datetime_format: 'date' },
      { name: 'status', label: 'Status', kind: 'enum', enum_values: ['pending', 'approved', 'rejected'] },
      { name: 'assignee_id', label: 'Assignee', kind: 'fk', fk_target: 'user', fk_label_field: 'name' },
      { name: 'creator_id', label: 'Creator', kind: 'fk', fk_target: 'user', fk_label_field: 'name' },
      { name: 'updater_id', label: 'Updater', kind: 'fk', fk_target: 'user', fk_label_field: 'name' },
    ],
  },
  {
    name: 'room_reservation',
    label: 'Room Reservation',
    groupable_fields: [
      { name: 'room_type_id', label: 'Room Type', kind: 'fk', fk_target: 'room_type', fk_label_field: 'name' },
      { name: 'room_id', label: 'Room', kind: 'fk', fk_target: 'room', fk_label_field: 'room_no' },
      { name: 'check_in', label: 'Check In', kind: 'datetime', datetime_format: 'date' },
      { name: 'check_out', label: 'Check Out', kind: 'datetime', datetime_format: 'date' },
      { name: 'creator_id', label: 'Creator', kind: 'fk', fk_target: 'user', fk_label_field: 'name' },
      { name: 'updater_id', label: 'Updater', kind: 'fk', fk_target: 'user', fk_label_field: 'name' },
    ],
  },
];

export function findDashboardEntity(name: string): DashboardEntity | undefined {
  return DASHBOARDABLE_ENTITIES.find((e) => e.name === name);
}

export function findDashboardField(entityName: string, fieldName: string): DashboardField | undefined {
  return findDashboardEntity(entityName)?.groupable_fields.find((f) => f.name === fieldName);
}
