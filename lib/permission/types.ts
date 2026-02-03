import type { Role } from '@/lib/role/types';

export type Permission = {
  id: string;
  name: string;
  create: boolean;
  read: boolean;
  update: boolean;
  remove: boolean;
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
    remove: boolean;
    role_id: string | null;
    role?: Role | null;
  };
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;

  allRoles?: RoleOption[];
}>;
