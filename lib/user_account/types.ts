import type { ModelPermissions } from '@/lib/authz';

export type UserAccount = {
  id: string;
  name: string;
  email: string;
  password: string;
  api_key: string | null;
  avatar: string | null;

};

export type UserAccountDetail = UserAccount & {
  roles: Role[];
};

export type Role = {
  id: string;
  name: string;
  description: string | null;
};
export type UserAccountDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    name: string;
    email: string;
    password: string;
    api_key: string | null;
    avatar: string | null;
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
  allRoles?: Role[];
  currentUserId?: string | null;

  rolePermissions?: ModelPermissions;
}>;
