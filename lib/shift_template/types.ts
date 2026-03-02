import type { ModelPermissions } from '@/lib/authz';

import type { UserAccount } from '@/lib/user_account/types';

export type ShiftTemplate = {
  id: string;
  user_account_id: string;
  day_of_week: number;
  start_time: Date;
  end_time: Date;
  user_account?: UserAccount | null;
};

export type UserAccountOption = {
  id: string;
  name: string;
};

export type ShiftTemplateDetail = ShiftTemplate;

export type ShiftTemplateDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>
}>;

export type FormViewProps = Readonly<{
  src: {
    id: string;
    user_account_id: string;
    day_of_week: number;
    start_time: Date | null;
    end_time: Date | null;
    user_account?: UserAccount | null;
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
