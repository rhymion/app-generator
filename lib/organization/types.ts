import type { ModelPermissions } from '@/lib/authz';

export type Organization = {
  id: string;
  name: string;
  description: string | null;

};

export type OrganizationDetail = Organization & {
  user_accounts: UserAccount[];
};

export type UserAccount = {
  id: string;
  name: string;
  avatar: string | null;
};
export type OrganizationDetailPageProps = Readonly<{
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
    created_at?: string | Date;
    updated_at?: string | Date;
    creator?: { id: string; name: string } | null;
    updater?: { id: string; name: string } | null;
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  allUserAccounts?: UserAccount[];
  currentUserId?: string | null;

  userAccountPermissions?: ModelPermissions;
}>;
