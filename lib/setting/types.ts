import type { ModelPermissions } from '@/lib/authz';

export type Setting = {
  id: string;
  name: string;
  email: string;
  password: string | null;
  api_key: string | null;
  image: string | null;
  mfa_enabled: boolean;
  creator_id: string | null;
  creator?: { id: string; name: string } | null;
  updater?: { id: string; name: string } | null;
};

export type SettingDetail = Setting & {
  roles: Role[];
};

export type Role = {
  id: string;
  name: string;
  description: string | null;
};

export type SettingDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    name: string;
    email: string;
    password: string | null;
    api_key: string | null;
    image: string | null;
    mfa_enabled: boolean;
    roles: Role[];
    created_at?: string | Date;
    updated_at?: string | Date;
    creator?: { id: string; name: string } | null;
    updater?: { id: string; name: string } | null;
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  initialRoles?: Role[];
  searchRoleOptions?: (query: string, includeIds: string[]) => Promise<Role[]>;
  currentUserId?: string | null;
}>;
