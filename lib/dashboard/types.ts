import type { ModelPermissions } from '@/lib/authz';

export type Dashboard = {
  id: string;
  name: string;
  creator_id: string | null;
  creator?: { id: string; name: string } | null;
  updater?: { id: string; name: string } | null;
};

export type DashboardDetail = Dashboard & {
  widgets: DashboardWidget[];
};

export type DashboardWidget = {
  id: string;
  dashboard_id: string;
  name: string;
  entity_name: string;
  chart_type: number;
  stack_mode: number | null;
  series_field: string | null;
  group_by_bucket: number | null;
  group_by_field: string;
  filter_field: string | null;
  filter_value: string | null;
  order: number;
  dashboard?: Dashboard | null;
};

export type DashboardDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    name: string;
    widgets: DashboardWidget[];
    created_at?: string | Date;
    updated_at?: string | Date;
    creator?: { id: string; name: string } | null;
    updater?: { id: string; name: string } | null;
  };
  permissions?: ModelPermissions;
  currentUserRoleIds?: string[];
  currentUserId?: string | null;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  initialDashboards?: Dashboard[];
  searchDashboardOptions?: (query: string, includeIds: string[]) => Promise<Dashboard[]>;
  currentUserId?: string | null;
}>;
