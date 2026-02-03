import type { ModelPermissions } from '@/lib/authz';

export type Role = {
  id: string;
  name: string;
  description: string | null;

};

export type RoleDetail = Role & {
  user_accounts: UserAccount[];
};

export type UserAccount = {
  id: string;
  name: string;
  email: string;
  password: string;
  api_key: string | null;
  avatar: string | null;
};
export type RoleDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    name: string;
    description: string | null;
    user_accounts: UserAccount[];
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  allUserAccounts?: UserAccount[];

}>;
