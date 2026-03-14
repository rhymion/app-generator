import type { ModelPermissions } from '@/lib/authz';
import type { UserAccount } from '@/lib/user_account/types';

export type Procedure = {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  assignee_id: string | null;
  creator_id: string | null;
  parent?: Procedure | null;
  assignee?: UserAccount | null;
};

export type UserAccountOption = {
  id: string;
  name: string;
};

export type ProcedureDetail = Procedure & {
  children: Procedure[];
  preceded_by: Procedure[];
  followed_by: Procedure[];
};

export type ProcedureDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    name: string;
    description: string | null;
    parent_id: string | null;
    assignee_id: string | null;
    parent?: Procedure | null;
    assignee?: UserAccount | null;
    children: Procedure[];
    preceded_by: Procedure[];
    followed_by: Procedure[];
    created_at?: string | Date;
    updated_at?: string | Date;
    creator?: { id: string; name: string } | null;
    updater?: { id: string; name: string } | null;
  };
  permissions?: ModelPermissions;
}>;

export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  allProcedures?: Procedure[];
  allUserAccounts?: UserAccount[];
  currentUserId?: string | null;
  procedurePermissions?: ModelPermissions;
  userAccountPermissions?: ModelPermissions;
}>;
