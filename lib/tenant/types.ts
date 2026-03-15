import type { ModelPermissions } from '@/lib/authz';

export type Tenant = {
  id: string;
  name: string | null;
};

export type TenantDetail = Tenant;

export type TenantDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    name: string | null;
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  currentUserId?: string | null;
}>;
