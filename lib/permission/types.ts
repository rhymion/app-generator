import type { ModelPermissions } from '@/lib/authz';
import type { Role } from '@/lib/role/types';

export type Permission = {
  id: string;
  name: string;
  create: boolean;
  read: boolean;
  update: boolean;
  delete: boolean;
  role_id: string | null;
  role?: Role | null;
};

export type RoleOption = {
  id: string;
  name: string;
};

export type PermissionDetail = Permission;

export type PermissionDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    name: string;
    create: boolean;
    read: boolean;
    update: boolean;
    delete: boolean;
    role_id: string | null;
    role?: Role | null;
    created_at?: string | Date;
    updated_at?: string | Date;
    creator?: { id: string; name: string } | null;
    updater?: { id: string; name: string } | null;
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  allRoles?: Role[];
  currentUserId?: string | null;
  rolePermissions?: ModelPermissions;
}>;
